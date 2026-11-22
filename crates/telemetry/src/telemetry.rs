//! Anonymous usage telemetry (`features/telemetry`): batched, content-free events posted to
//! `/api/telemetry/events`, only while the `telemetry` setting is on (it is off by default).
//! Events never carry paths, project names, prompts or editor text: crash text is redacted and
//! every other payload is built from enums and checked identifiers.
//!
//! The queue lives in `telemetry.json` beside the settings and is sent every five minutes, when
//! it reaches fifty events, right away for a crash, and once more when the app quits.

#[cfg(any(test, feature = "test-support"))]
pub mod mock_server;
mod queue;
mod redaction;
mod signals;

use std::{path::PathBuf, time::Duration};

use gpui::{App, AsyncApp, Global, Task};
use serde_json::{Map, Value, json};

pub use queue::{Batch, ClientContext, Enqueued, LogEntry, LogStatus, Mode, Queue, QueuedEvent};
pub use redaction::{crash_report_build, is_expected_cancellation, redact_crash_text};
pub use signals::{AiFailure, AiFailurePhase, AiRunKind, DurationBucket, FrictionArea, FrictionKind, FrictionSignal};

const STARTUP_DELAY: Duration = Duration::from_secs(10);
const FLUSH_INTERVAL: Duration = Duration::from_secs(5 * 60);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
/// Sending on quit gets less time: whatever is not sent stays queued for the next launch.

pub struct TelemetryConfig {
    /// The account service, such as `https://athas.dev`.
    pub api_base: String,
    pub app_version: String,
    /// Where the queue is saved; `None` keeps it in memory.
    pub store_path: Option<PathBuf>,
}

impl TelemetryConfig {
    pub fn new(api_base: impl Into<String>, app_version: impl Into<String>) -> Self {
        Self { api_base: api_base.into(), app_version: app_version.into(), store_path: default_store_path() }
    }
}

/// `telemetry.json` in the app's data folder.
pub fn default_store_path() -> Option<PathBuf> {
    dirs::data_dir().map(|dir| dir.join(paths::APP_ID).join("telemetry.json"))
}

/// Where a panic leaves its redacted report for the next launch to queue.
fn pending_crash_path(store_path: &Option<PathBuf>) -> Option<PathBuf> {
    store_path.as_ref().map(|path| path.with_file_name("pending-crash.json"))
}

struct Telemetry {
    queue: Queue,
    api_base: String,
    flushing: bool,
    _quit: gpui::Subscription,
    _timer: Task<()>,
}

impl Global for Telemetry {}

fn telemetry_mut(cx: &mut App) -> Option<&mut Telemetry> {
    cx.has_global::<Telemetry>().then(|| cx.global_mut::<Telemetry>())
}

/// Whether the user allowed anonymous usage telemetry (Settings > Advanced).
pub fn enabled(cx: &App) -> bool {
    cx.try_global::<settings::SettingsStore>().is_some() && settings::get(cx).telemetry
}

/// Opens the queue, queues a crash a panic left behind, and starts the flush and heartbeat timer.
pub fn init(cx: &mut App, config: TelemetryConfig) {
    let mut queue = Queue::open(config.store_path.clone(), &config.app_version);
    if let Some(path) = pending_crash_path(&config.store_path)
        && let Ok(text) = std::fs::read_to_string(&path)
    {
        let _ = std::fs::remove_file(&path);
        if let Ok(Value::Object(payload)) = serde_json::from_str(&text) {
            queue.enqueue("crash_report", payload, Mode::Optional, enabled(cx), false, None);
        }
    }
    // Nothing is sent on the way out. GPUI gives every quit handler 200 ms together, a request
    // rarely finishes in that, and the queue is on disk after each event anyway: what is left
    // goes with the next start. Waiting here only delayed the quit and logged a timeout.
    let quit = cx.on_app_quit(|cx| {
        if let Some(telemetry) = telemetry_mut(cx) {
            telemetry.queue.save_now();
        }
        async {}
    });
    let timer = cx.spawn(async move |cx: &mut AsyncApp| {
        cx.background_executor().timer(STARTUP_DELAY).await;
        loop {
            cx.update(queue_heartbeat);
            let flush = cx.update(flush);
            flush.await;
            cx.background_executor().timer(FLUSH_INTERVAL).await;
        }
    });
    cx.set_global(Telemetry { queue, api_base: config.api_base, flushing: false, _quit: quit, _timer: timer });
}

/// Saves a redacted report of any panic, so the next launch can queue it (if telemetry is on
/// then). Call once, early; `store_path` is the queue's path from `TelemetryConfig`.
pub fn install_panic_hook(store_path: Option<PathBuf>) {
    let Some(path) = pending_crash_path(&store_path) else { return };
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let message = info
            .payload()
            .downcast_ref::<&str>()
            .map(|text| text.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_default();
        let source = info.location().map(|location| format!("{}:{}", location.file(), location.line()));
        // A panic that cannot unwind panics again on its way out ("panic in a function that cannot
        // unwind"), and that second report used to overwrite the first: every abort reached the
        // crash list with the wrapper's words and none of the cause. The first panic of a run is
        // the one that explains it, so it stays.
        if path.exists() {
            previous(info);
            return;
        }
        let backtrace = std::backtrace::Backtrace::force_capture().to_string();
        let report = crash_payload("panic", &message, Some(&backtrace), source.as_deref());
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&path, Value::Object(report).to_string());
        previous(info);
    }));
}

fn crash_payload(kind: &str, message: &str, stack: Option<&str>, source: Option<&str>) -> Map<String, Value> {
    let redact = |text: Option<&str>| text.and_then(redact_crash_text).map_or(Value::Null, Value::from);
    let mut payload = Map::new();
    payload.insert("kind".into(), kind.into());
    payload.insert("message".into(), redact(Some(message)));
    payload.insert("stack".into(), redact(stack));
    if source.is_some() {
        payload.insert("source".into(), redact(source));
    }
    payload.insert("report_source".into(), "desktop_runtime".into());
    payload.insert("build".into(), crash_report_build().into());
    payload
}

fn enqueue(cx: &mut App, event_type: &str, payload: Map<String, Value>, mode: Mode, flush_immediately: bool, log: Option<(String, String)>) -> bool {
    let enabled = enabled(cx);
    let Some(telemetry) = telemetry_mut(cx) else { return false };
    match telemetry.queue.enqueue(event_type, payload, mode, enabled, flush_immediately, log) {
        Enqueued::Skipped => false,
        Enqueued::Queued { flush_now } => {
            if flush_now {
                flush(cx).detach();
            }
            true
        }
    }
}

/// Queues a redacted crash report and sends it right away.
pub fn record_crash(cx: &mut App, kind: &str, message: &str, stack: Option<&str>) -> bool {
    if is_expected_cancellation(message) {
        return false;
    }
    enqueue(cx, "crash_report", crash_payload(kind, message, stack, None), Mode::Optional, true, None)
}

/// Queues a friction signal; with telemetry off it is only noted in the local log, which the
/// feedback dialog counts.
pub fn record_friction(cx: &mut App, signal: FrictionSignal) -> bool {
    let log_name = signal.log_name();
    if !enabled(cx) {
        if let Some(telemetry) = telemetry_mut(cx) {
            telemetry.queue.record_local(&log_name, "Stored locally because anonymous usage telemetry is off");
        }
        return false;
    }
    enqueue(cx, "friction", signal.payload(), Mode::Optional, false, Some((log_name, "Queued anonymous friction signal".into())))
}

pub fn record_ai_failure(cx: &mut App, failure: &AiFailure) -> bool {
    enqueue(cx, "ai_failure", failure.payload(), Mode::Optional, false, Some((failure.log_name(), "Queued anonymous AI failure signal".into())))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UpdateCheckStatus {
    Available,
    UpToDate,
    Failed,
}

/// The update check is sent even with usage telemetry off; it carries versions only.
pub fn record_update_check(cx: &mut App, status: UpdateCheckStatus, current_version: &str, available_version: Option<&str>) -> bool {
    let status = match status {
        UpdateCheckStatus::Available => "available",
        UpdateCheckStatus::UpToDate => "up_to_date",
        UpdateCheckStatus::Failed => "failed",
    };
    let payload = json!({
        "status": status,
        "currentVersion": current_version,
        "availableVersion": available_version,
        "updater_enabled": true,
    });
    let Value::Object(payload) = payload else { return false };
    enqueue(cx, "update_check", payload, Mode::Required, false, None)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExtensionLifecycle {
    Install,
    Uninstall,
    Update,
}

pub fn record_extension_lifecycle(cx: &mut App, lifecycle: ExtensionLifecycle, extension_id: &str, version: Option<&str>) -> bool {
    let event_type = match lifecycle {
        ExtensionLifecycle::Install => "extension_install",
        ExtensionLifecycle::Uninstall => "extension_uninstall",
        ExtensionLifecycle::Update => "extension_update",
    };
    let Value::Object(payload) = json!({ "extension_id": extension_id, "extension_version": version }) else { return false };
    enqueue(cx, event_type, payload, Mode::Optional, false, None)
}

/// A start that took 5 s or more to show the workbench (`startup:slow_ready`).
pub fn record_startup(cx: &mut App, elapsed: Duration) -> bool {
    if elapsed < Duration::from_secs(5) {
        return false;
    }
    let signal = FrictionSignal { duration: Some(DurationBucket::of(elapsed)), ..FrictionSignal::new(FrictionArea::Startup, FrictionKind::SlowReady) };
    record_friction(cx, signal)
}

fn summarize(installed: &[(String, Option<String>)]) -> Value {
    Value::Array(installed.iter().map(|(id, version)| json!({ "id": id, "version": version })).collect())
}

/// The installed extensions, once they are loaded (`recordExtensionRegistrySync`).
pub fn record_extension_registry_sync(cx: &mut App, installed: &[(String, Option<String>)]) -> bool {
    let Value::Object(payload) = json!({ "installed_extensions": summarize(installed), "installed_count": installed.len() }) else { return false };
    enqueue(cx, "extension_registry_sync", payload, Mode::Optional, false, None)
}

/// An update check of the installed extensions and what has an update.
pub fn record_extension_update_check(cx: &mut App, installed: &[(String, Option<String>)], updates: &[String]) -> bool {
    let payload = json!({
        "installed_extensions": summarize(installed),
        "update_candidates": updates,
        "installed_count": installed.len(),
        "update_count": updates.len(),
    });
    let Value::Object(payload) = payload else { return false };
    enqueue(cx, "extension_update_check", payload, Mode::Optional, false, None)
}

fn queue_heartbeat(cx: &mut App) {
    let now = chrono::Utc::now().timestamp_millis();
    let due = cx.try_global::<Telemetry>().is_some_and(|telemetry| telemetry.queue.heartbeat_due(now));
    if !due {
        return;
    }
    let payload = json!({
        "updater_enabled": true,
        "session_platform": std::env::consts::OS,
        "session_arch": std::env::consts::ARCH,
    });
    let Value::Object(payload) = payload else { return };
    if enqueue(cx, "heartbeat", payload, Mode::Optional, false, None)
        && let Some(telemetry) = telemetry_mut(cx)
    {
        telemetry.queue.mark_heartbeat(now);
    }
}

/// Sends the queue; resolves to whether everything went out (an empty queue counts).
pub fn flush(cx: &mut App) -> Task<bool> {
    flush_with_timeout(cx, REQUEST_TIMEOUT)
}

fn flush_with_timeout(cx: &mut App, timeout: Duration) -> Task<bool> {
    let enabled = enabled(cx);
    let Some(telemetry) = telemetry_mut(cx) else { return Task::ready(true) };
    if telemetry.flushing {
        return Task::ready(false);
    }
    let Some(batch) = telemetry.queue.batch(enabled) else { return Task::ready(true) };
    telemetry.flushing = true;
    let api_base = telemetry.api_base.clone();
    let bodies = batch.bodies.clone();
    let send = cx.background_executor().spawn(async move { send(&api_base, &bodies, timeout) });
    cx.spawn(async move |cx: &mut AsyncApp| {
        let result = send.await;
        let sent = result.is_ok();
        cx.update(|cx| {
            if let Some(telemetry) = telemetry_mut(cx) {
                telemetry.flushing = false;
                telemetry.queue.finish(&batch, result);
            }
        });
        sent
    })
}

/// The web build keeps its events in the local log; uploads go through the desktop client.
#[cfg(target_family = "wasm")]
pub fn send(_: &str, _: &[Value], _: Duration) -> Result<(), String> {
    Err("Telemetry is not uploaded from the web build".into())
}

/// Posts each chunk to `/api/telemetry/events`.
#[cfg(not(target_family = "wasm"))]
pub fn send(api_base: &str, bodies: &[Value], timeout: Duration) -> Result<(), String> {
    let client = reqwest::blocking::Client::builder().timeout(timeout).build().map_err(|error| error.to_string())?;
    let url = format!("{}/api/telemetry/events", api_base.trim_end_matches('/'));
    for body in bodies {
        let response = client.post(&url).json(body).send().map_err(|error| error.to_string())?;
        if !response.status().is_success() {
            return Err(format!("Telemetry upload failed ({})", response.status().as_u16()));
        }
    }
    Ok(())
}

/// The local log of what was queued, sent, dropped or kept local (Settings > Advanced).
pub fn log_entries(cx: &App) -> Vec<LogEntry> {
    cx.try_global::<Telemetry>().map(|telemetry| telemetry.queue.log().to_vec()).unwrap_or_default()
}

pub fn clear_log(cx: &mut App) {
    if let Some(telemetry) = telemetry_mut(cx) {
        telemetry.queue.clear_log();
    }
}

/// Counts of the friction signals in the local log, by name, for the feedback environment.
pub fn friction_counts(entries: &[LogEntry]) -> Vec<(String, usize)> {
    let mut counts: std::collections::BTreeMap<String, usize> = Default::default();
    for entry in entries.iter().filter(|entry| entry.event_type.starts_with("friction:")) {
        *counts.entry(entry.event_type.clone()).or_default() += 1;
    }
    counts.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use mock_server::{MockServer, Response};

    #[test]
    fn posts_batches_to_the_events_endpoint() {
        let server = MockServer::start(|_| Response::json(200, json!({ "ok": true })));
        let dir = tempfile::tempdir().unwrap();
        let mut queue = Queue::open(Some(dir.path().join("telemetry.json")), "0.1.0");
        let signal = FrictionSignal::new(FrictionArea::Feedback, FrictionKind::Opened);
        queue.enqueue("friction", signal.payload(), Mode::Optional, true, false, None);
        let batch = queue.batch(true).unwrap();
        let result = send(server.url(), &batch.bodies, REQUEST_TIMEOUT);
        queue.finish(&batch, result);
        assert!(queue.is_empty());

        let requests = server.requests();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].method, "POST");
        assert_eq!(requests[0].path, "/api/telemetry/events");
        let body = requests[0].json();
        assert_eq!(body["device_id"], queue.context().device_id.as_str());
        assert_eq!(body["app_version"], "0.1.0");
        assert_eq!(body["events"][0]["type"], "friction");
        assert_eq!(body["events"][0]["payload"]["area"], "feedback");
    }

    #[test]
    fn extension_summaries_keep_ids_and_versions() {
        let summary = summarize(&[("athas.rust".into(), Some("1.2.0".into())), ("athas.go".into(), None)]);
        assert_eq!(summary, json!([{ "id": "athas.rust", "version": "1.2.0" }, { "id": "athas.go", "version": null }]));
    }

    #[test]
    fn a_failed_upload_keeps_the_queue() {
        let server = MockServer::start(|_| Response::json(503, json!({ "error": "down" })));
        let mut queue = Queue::open(None, "0.1.0");
        queue.enqueue("heartbeat", Map::new(), Mode::Optional, true, false, None);
        let batch = queue.batch(true).unwrap();
        let result = send(server.url(), &batch.bodies, REQUEST_TIMEOUT);
        assert_eq!(result, Err("Telemetry upload failed (503)".to_string()));
        queue.finish(&batch, result);
        assert_eq!(queue.len(), 1);
    }

    #[test]
    fn crash_payloads_are_redacted() {
        let payload = crash_payload("panic", "no such file \"/Users/alex/a.rs\"", Some("at /home/alex/x.rs:3"), Some("crates/a/src/lib.rs:9"));
        assert_eq!(payload["message"], "no such file <redacted>");
        assert_eq!(payload["stack"], "at <path>:3");
        assert_eq!(payload["source"], "crates/a/src/lib.rs:9");
        assert_eq!(payload["report_source"], "desktop_runtime");
    }

    #[test]
    fn counts_friction_in_the_log() {
        let mut queue = Queue::open(None, "0.1.0");
        queue.record_local("friction:feedback:opened", "local");
        queue.record_local("friction:feedback:opened", "local");
        queue.record_local("friction:agent:retry", "local");
        assert_eq!(
            friction_counts(queue.log()),
            vec![("friction:agent:retry".to_string(), 1), ("friction:feedback:opened".to_string(), 2)]
        );
    }
}
