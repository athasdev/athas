//! The event queue and its local log, saved in `telemetry.json` so events survive a restart
//! (`services/telemetry.ts`). Nothing here touches the network.

use std::path::{Path, PathBuf};

use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

/// Events sent together; also the queue length that triggers a flush.
pub const FLUSH_THRESHOLD: usize = 50;
pub const MAX_QUEUE_LENGTH: usize = 200;
pub const MAX_LOG_ENTRIES: usize = 150;
pub const HEARTBEAT_INTERVAL_MS: i64 = 5 * 60 * 1000;

/// Event types sent even with usage telemetry off: the update check, which the update service
/// needs to answer at all.
const REQUIRED_EVENTS: &[&str] = &["update_check"];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Required,
    Optional,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedEvent {
    pub id: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub occurred_at: String,
    pub payload: Map<String, Value>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogStatus {
    Local,
    Queued,
    Sent,
    Failed,
    Dropped,
    Cleared,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub id: String,
    pub timestamp: String,
    pub status: LogStatus,
    pub event_type: String,
    pub summary: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl LogEntry {
    /// When it happened in the local time zone, as the settings' log shows it (the original's
    /// `new Date(timestamp).toLocaleString()`); the stored timestamp is UTC.
    pub fn local_time(&self) -> String {
        match chrono::DateTime::parse_from_rfc3339(&self.timestamp) {
            Ok(time) => time.with_timezone(&chrono::Local).format("%Y-%m-%d %H:%M:%S").to_string(),
            Err(_) => self.timestamp.clone(),
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Stored {
    device_id: Option<String>,
    last_heartbeat_ms: Option<i64>,
    queue: Vec<QueuedEvent>,
    log: Vec<LogEntry>,
    install_date: Option<String>,
    launch_count: u32,
    last_app_version: Option<String>,
}

/// Who is sending: an anonymous device id and the build, never the user.
#[derive(Clone, Debug, PartialEq)]
pub struct ClientContext {
    pub device_id: String,
    pub app_version: String,
    pub platform: String,
    pub arch: String,
    pub install_date: String,
    /// The version that ran before this one, on the first launch after an update.
    pub previous_version: Option<String>,
    pub launch_count: u32,
}

/// What `enqueue` did.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Enqueued {
    /// Usage telemetry is off, so the event was not kept.
    Skipped,
    Queued { flush_now: bool },
}

/// Events taken from the queue to send: the request bodies, and the ids to forget once sent.
#[derive(Clone, Debug, PartialEq)]
pub struct Batch {
    pub bodies: Vec<Value>,
    pub ids: Vec<String>,
}

pub struct Queue {
    stored: Stored,
    context: ClientContext,
    path: Option<PathBuf>,
}

pub fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

impl Queue {
    /// Reads the saved queue and counts this launch.
    pub fn open(path: Option<PathBuf>, app_version: &str) -> Self {
        let mut stored: Stored = path
            .as_deref()
            .and_then(|path| std::fs::read_to_string(path).ok())
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default();
        let device_id = stored.device_id.get_or_insert_with(new_id).clone();
        let install_date = stored.install_date.get_or_insert_with(now_iso).clone();
        stored.launch_count += 1;
        let previous_version = stored.last_app_version.replace(app_version.to_string()).filter(|previous| previous != app_version);
        let context = ClientContext {
            device_id,
            app_version: app_version.to_string(),
            platform: std::env::consts::OS.to_string(),
            arch: std::env::consts::ARCH.to_string(),
            install_date,
            previous_version,
            launch_count: stored.launch_count,
        };
        let queue = Self { stored, context, path };
        queue.save();
        queue
    }

    pub fn context(&self) -> &ClientContext {
        &self.context
    }

    pub fn len(&self) -> usize {
        self.stored.queue.len()
    }

    pub fn is_empty(&self) -> bool {
        self.stored.queue.is_empty()
    }

    pub fn events(&self) -> &[QueuedEvent] {
        &self.stored.queue
    }

    pub fn log(&self) -> &[LogEntry] {
        &self.stored.log
    }

    /// Queues an event unless it is optional and usage telemetry is off. `log_name` and `summary`
    /// say what the local log shows for it.
    pub fn enqueue(
        &mut self,
        event_type: &str,
        mut payload: Map<String, Value>,
        mode: Mode,
        enabled: bool,
        flush_immediately: bool,
        log: Option<(String, String)>,
    ) -> Enqueued {
        if mode == Mode::Optional && !enabled {
            return Enqueued::Skipped;
        }
        payload.insert("install_date".into(), self.context.install_date.clone().into());
        payload.insert("previous_version".into(), self.context.previous_version.clone().map_or(Value::Null, Value::from));
        payload.insert("launch_count".into(), self.context.launch_count.into());
        self.stored.queue.push(QueuedEvent {
            id: new_id(),
            event_type: event_type.to_string(),
            occurred_at: now_iso(),
            payload,
        });
        while self.stored.queue.len() > MAX_QUEUE_LENGTH {
            let dropped = self.stored.queue.remove(0);
            self.push_log(
                LogStatus::Dropped,
                &dropped.event_type,
                format!("Dropped {} from local queue to stay under {MAX_QUEUE_LENGTH} events", dropped.event_type),
                None,
            );
        }
        let (log_name, summary) = log.unwrap_or_else(|| (event_type.to_string(), format!("Queued {event_type}")));
        self.push_log(LogStatus::Queued, &log_name, summary, None);
        self.save();
        Enqueued::Queued { flush_now: flush_immediately || self.stored.queue.len() >= FLUSH_THRESHOLD }
    }

    /// Notes a signal in the local log only, as Athas does while usage telemetry is off.
    pub fn record_local(&mut self, log_name: &str, summary: impl Into<String>) {
        self.push_log(LogStatus::Local, log_name, summary.into(), None);
        self.save();
    }

    /// The queued events to send, in chunks of `FLUSH_THRESHOLD`. Events queued while usage
    /// telemetry was on are not sent after it is turned off; they are dropped here.
    pub fn batch(&mut self, enabled: bool) -> Option<Batch> {
        if !enabled {
            let before = self.stored.queue.len();
            self.stored.queue.retain(|event| REQUIRED_EVENTS.contains(&event.event_type.as_str()));
            if self.stored.queue.len() != before {
                self.save();
            }
        }
        if self.stored.queue.is_empty() {
            return None;
        }
        let context = &self.context;
        let bodies = self
            .stored
            .queue
            .chunks(FLUSH_THRESHOLD)
            .map(|chunk| {
                json!({
                    "device_id": context.device_id,
                    "app_version": context.app_version,
                    "platform": context.platform,
                    "arch": context.arch,
                    "events": chunk.iter().map(|event| json!({
                        "id": event.id,
                        "type": event.event_type,
                        "occurred_at": event.occurred_at,
                        "payload": event.payload,
                    })).collect::<Vec<_>>(),
                })
            })
            .collect();
        let ids = self.stored.queue.iter().map(|event| event.id.clone()).collect();
        Some(Batch { bodies, ids })
    }

    /// Records how sending `batch` went; sent events leave the queue, and anything queued while
    /// it was in flight stays.
    pub fn finish(&mut self, batch: &Batch, result: Result<(), String>) {
        let count = batch.ids.len();
        let plural = if count == 1 { "" } else { "s" };
        match result {
            Ok(()) => {
                self.stored.queue.retain(|event| !batch.ids.contains(&event.id));
                self.push_log(LogStatus::Sent, "batch", format!("Sent {count} telemetry event{plural}"), None);
            }
            Err(error) => {
                self.push_log(LogStatus::Failed, "batch", format!("Failed to send {count} telemetry event{plural}"), Some(error));
            }
        }
        self.save();
    }

    pub fn heartbeat_due(&self, now_ms: i64) -> bool {
        self.stored.last_heartbeat_ms.is_none_or(|last| now_ms - last >= HEARTBEAT_INTERVAL_MS)
    }

    pub fn mark_heartbeat(&mut self, now_ms: i64) {
        self.stored.last_heartbeat_ms = Some(now_ms);
        self.save();
    }

    pub fn clear_log(&mut self) {
        self.stored.log.clear();
        self.push_log(LogStatus::Cleared, "log", "Cleared local telemetry log".into(), None);
        self.save();
    }

    fn push_log(&mut self, status: LogStatus, event_type: &str, summary: String, error: Option<String>) {
        self.stored.log.push(LogEntry {
            id: new_id(),
            timestamp: now_iso(),
            status,
            event_type: event_type.to_string(),
            summary,
            error,
        });
        let excess = self.stored.log.len().saturating_sub(MAX_LOG_ENTRIES);
        self.stored.log.drain(..excess);
    }

    fn save(&self) {
        let Some(path) = &self.path else { return };
        if let Err(error) = write_atomically(path, &self.stored) {
            eprintln!("telemetry: could not save {}: {error:#}", path.display());
        }
    }
}

fn write_atomically(path: &Path, stored: &Stored) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let temp = path.with_extension("json.tmp");
    std::fs::write(&temp, serde_json::to_vec(stored)?)?;
    std::fs::rename(&temp, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn log_times_show_in_the_local_zone() {
        let entry = |timestamp: &str| LogEntry { id: "1".into(), timestamp: timestamp.into(), status: LogStatus::Sent, event_type: "e".into(), summary: String::new(), error: None };
        let utc = chrono::DateTime::parse_from_rfc3339("2026-11-13T21:05:09.123Z").unwrap();
        let expected = utc.with_timezone(&chrono::Local).format("%Y-%m-%d %H:%M:%S").to_string();
        assert_eq!(entry("2026-11-13T21:05:09.123Z").local_time(), expected);
        assert_eq!(entry("not a time").local_time(), "not a time");
    }

    fn queue() -> (tempfile::TempDir, Queue) {
        let dir = tempfile::tempdir().unwrap();
        let queue = Queue::open(Some(dir.path().join("telemetry.json")), "1.0.0");
        (dir, queue)
    }

    #[test]
    fn optional_events_wait_for_consent() {
        let (_dir, mut queue) = queue();
        assert_eq!(queue.enqueue("heartbeat", Map::new(), Mode::Optional, false, false, None), Enqueued::Skipped);
        assert!(queue.is_empty());
        assert_eq!(
            queue.enqueue("update_check", Map::new(), Mode::Required, false, false, None),
            Enqueued::Queued { flush_now: false }
        );
        assert_eq!(queue.len(), 1);
        assert_eq!(queue.events()[0].payload["launch_count"], 1);
    }

    #[test]
    fn turning_telemetry_off_drops_optional_events_before_sending() {
        let (_dir, mut queue) = queue();
        queue.enqueue("heartbeat", Map::new(), Mode::Optional, true, false, None);
        queue.enqueue("update_check", Map::new(), Mode::Required, true, false, None);
        let batch = queue.batch(false).unwrap();
        assert_eq!(batch.ids.len(), 1);
        assert_eq!(batch.bodies[0]["events"][0]["type"], "update_check");
        assert_eq!(queue.len(), 1);
    }

    #[test]
    fn caps_the_queue_and_flushes_at_the_threshold() {
        let (_dir, mut queue) = queue();
        let mut last = Enqueued::Skipped;
        for _ in 0..FLUSH_THRESHOLD {
            last = queue.enqueue("friction", Map::new(), Mode::Optional, true, false, None);
        }
        assert_eq!(last, Enqueued::Queued { flush_now: true });
        for _ in 0..MAX_QUEUE_LENGTH {
            queue.enqueue("friction", Map::new(), Mode::Optional, true, false, None);
        }
        assert_eq!(queue.len(), MAX_QUEUE_LENGTH);
        assert!(queue.log().iter().any(|entry| entry.status == LogStatus::Dropped));
        assert_eq!(queue.log().len(), MAX_LOG_ENTRIES);
        let batch = queue.batch(true).unwrap();
        assert_eq!(batch.bodies.len(), MAX_QUEUE_LENGTH / FLUSH_THRESHOLD);
    }

    #[test]
    fn sent_events_leave_and_later_ones_stay() {
        let (_dir, mut queue) = queue();
        queue.enqueue("heartbeat", Map::new(), Mode::Optional, true, false, None);
        let batch = queue.batch(true).unwrap();
        queue.enqueue("friction", Map::new(), Mode::Optional, true, false, None);
        queue.finish(&batch, Ok(()));
        assert_eq!(queue.len(), 1);
        assert_eq!(queue.events()[0].event_type, "friction");
        let batch = queue.batch(true).unwrap();
        queue.finish(&batch, Err("offline".into()));
        assert_eq!(queue.len(), 1);
        assert_eq!(queue.log().last().unwrap().status, LogStatus::Failed);
    }

    #[test]
    fn the_queue_and_device_survive_a_restart() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("telemetry.json");
        let mut first = Queue::open(Some(path.clone()), "1.0.0");
        first.enqueue("heartbeat", Map::new(), Mode::Optional, true, false, None);
        let device = first.context().device_id.clone();
        let second = Queue::open(Some(path), "1.1.0");
        assert_eq!(second.context().device_id, device);
        assert_eq!(second.context().launch_count, 2);
        assert_eq!(second.context().previous_version.as_deref(), Some("1.0.0"));
        assert_eq!(second.len(), 1);
    }

    #[test]
    fn heartbeats_are_spaced() {
        let (_dir, mut queue) = queue();
        assert!(queue.heartbeat_due(0));
        queue.mark_heartbeat(1_000);
        assert!(!queue.heartbeat_due(2_000));
        assert!(queue.heartbeat_due(1_000 + HEARTBEAT_INTERVAL_MS));
    }
}
