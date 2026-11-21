use std::sync::Arc;
use std::time::Duration;

use futures::executor::block_on;
use serde_json::{Value, json};

use crate::adapter::normalize_generative_view;
use crate::permissions::is_network_request_allowed;
use crate::view::{FormValue, Node, collect_form_fields, parse_view};
use crate::*;

fn error_of(value: Value) -> String {
    parse_view(&value).unwrap_err().to_string()
}

#[test]
fn parses_a_full_view() {
    let node = parse_view(&json!({
        "type": "screen",
        "title": "Deploys",
        "actions": [{ "label": "Refresh", "icon": "refresh", "action": { "command": "x.refresh" } }],
        "children": [
            { "type": "row", "children": [
                { "type": "metric", "label": "Builds", "value": 12, "tone": "success" },
                { "type": "metric", "label": "Status", "value": "ok" }
            ]},
            { "type": "progress", "value": 140 },
            { "type": "table", "columns": ["Name", "Count"], "rows": [["a", 1], ["b"]] },
            { "type": "form", "submitLabel": "Save", "onSubmit": { "command": "x.save", "args": [1] }, "children": [
                { "type": "input", "name": "title", "required": true, "value": "Hi" },
                { "type": "toggle", "name": "on", "label": "On", "checked": true },
                { "type": "choice", "name": "kinds", "multiple": true, "value": ["a"], "options": [{ "label": "A", "value": "a" }, { "label": "B", "value": "b" }] }
            ]},
            { "type": "tree", "label": "Files", "items": [{ "id": "1", "title": "src", "children": [{ "id": "2", "title": "main.rs" }] }] },
            { "type": "divider" }
        ]
    }))
    .unwrap();
    let Node::Screen { title, children, .. } = &node else { panic!("expected a screen") };
    assert_eq!(title.as_deref(), Some("Deploys"));
    assert!(matches!(children[1], Node::Progress { value, .. } if value == 100.0));
    let Node::Form { children: fields, .. } = &children[3] else { panic!("expected a form") };
    let fields = collect_form_fields(fields);
    assert_eq!(fields.iter().map(|field| field.name.as_str()).collect::<Vec<_>>(), ["title", "on", "kinds"]);
    assert_eq!(fields[2].value, FormValue::List(vec!["a".into()]));
    assert_eq!(node.to_json()["children"][0]["children"][0]["value"], json!(12.0));
}

#[test]
fn rejects_invalid_views_with_the_original_messages() {
    assert_eq!(error_of(json!({ "type": "marquee" })), "Invalid integration view at $.type: unsupported node type \"marquee\"");
    assert_eq!(error_of(json!({ "type": "text" })), "Invalid integration view at $.value: expected a string");
    assert_eq!(error_of(json!({ "type": "badge", "label": " " })), "Invalid integration view at $.label: must not be empty");
    assert_eq!(error_of(json!({ "type": "text", "value": "x", "tone": "loud" })), "Invalid integration view at $.tone: expected one of default, muted, accent, success, warning, error");
    assert_eq!(
        error_of(json!({ "type": "input", "name": "x" })),
        "Invalid integration view at $: form field metadata is only valid inside a form"
    );
    assert_eq!(error_of(json!({ "type": "input" })), "Invalid integration view at $: requires onChange, onSubmit, or a form field name");
    let form = |children: Value| json!({ "type": "form", "submitLabel": "Go", "onSubmit": { "command": "go" }, "children": children });
    assert_eq!(
        error_of(form(json!([{ "type": "input", "name": "a" }, { "type": "textarea", "name": "a" }]))),
        "Invalid integration view at $.children: contains duplicate field name \"a\""
    );
    assert_eq!(error_of(form(json!([form(json!([]))]))), "Invalid integration view at $.children[0]: forms must not be nested");
    assert_eq!(error_of(form(json!([{ "type": "text", "value": "x" }]))), "Invalid integration view at $.children: must contain at least one named field");
    assert_eq!(
        error_of(form(json!([{ "type": "input", "name": "1x" }]))),
        "Invalid integration view at $.children[0].name: must start with a letter and contain only letters, numbers, ., _, or -"
    );
    assert_eq!(
        error_of(json!({ "type": "choice", "value": "z", "onChange": { "command": "c" }, "options": [{ "label": "A", "value": "a" }] })),
        "Invalid integration view at $.value: must reference enabled options"
    );
    assert_eq!(error_of(json!({ "type": "numberInput", "value": 5, "max": 3, "onChange": { "command": "c" } })), "Invalid integration view at $.value: must not be greater than the maximum");
    assert_eq!(error_of(json!({ "type": "table", "columns": ["a"], "rows": [[1, 2]] })), "Invalid integration view at $.rows[0]: contains more cells than the table has columns");
    assert_eq!(error_of(json!({ "type": "sparkline", "label": "x", "values": [1] })), "Invalid integration view at $.values: must contain at least two points");
    assert_eq!(
        error_of(json!({ "type": "tree", "label": "t", "items": [{ "id": "a", "title": "A" }, { "id": "a", "title": "B" }] })),
        "Invalid integration view at $.items[1].id: contains duplicate tree item id \"a\""
    );
    assert_eq!(error_of(json!({ "type": "button", "label": "x", "action": { "command": "c", "args": vec![0; 21] } })), "Invalid integration view at $.action.args: must contain at most 20 values");
}

#[test]
fn enforces_the_size_limits() {
    let mut deep = json!({ "type": "divider" });
    for _ in 0..21 {
        deep = json!({ "type": "stack", "children": [deep] });
    }
    assert!(error_of(deep).contains("exceeds the maximum depth of 20"));
    let wide: Vec<Value> = (0..100).map(|_| json!({ "type": "stack", "children": (0..5).map(|_| json!({ "type": "divider" })).collect::<Vec<_>>() })).collect();
    assert!(error_of(json!({ "type": "stack", "children": wide })).contains("exceeds the maximum node count of 500"));
    let long = "x".repeat(20_001);
    assert!(error_of(json!({ "type": "text", "value": long })).contains("must be at most 20000 characters"));
    let texts: Vec<Value> = (0..30).map(|_| json!({ "type": "text", "value": "y".repeat(19_000) })).collect();
    assert!(error_of(json!({ "type": "stack", "children": texts })).contains("exceeds the maximum text payload of 500000 characters"));
}

#[test]
fn converts_legacy_generative_components() {
    let node = normalize_generative_view(&json!({
        "type": "card",
        "props": { "title": "Report" },
        "children": [
            { "type": "table", "props": { "headers": ["A"], "rows": [[1, 2]] } },
            { "type": "list", "props": { "items": ["one", 2] } }
        ],
        "actions": [{ "id": "a", "label": "Docs", "url": "https://athas.dev", "style": "primary" }, { "id": "b", "label": "" }]
    }))
    .unwrap();
    let json = node.to_json();
    assert_eq!(json["type"], "card");
    assert_eq!(json["children"][0]["columns"], json!(["A", "Column 2"]));
    assert_eq!(json["children"][1]["children"][1]["title"], "2");
    assert_eq!(json["children"][2]["action"], json!({ "command": "athas.openExternal", "args": ["https://athas.dev"] }));
    assert_eq!(json["children"][2]["tone"], "accent");
    assert_eq!(json["children"].as_array().unwrap().len(), 3);
    assert!(normalize_generative_view(&json!({ "type": "chart", "props": {} })).unwrap_err().to_string().contains("Unsupported legacy generative UI component: chart"));
}

#[test]
fn checks_network_permissions() {
    let patterns = vec!["https://api.github.com".to_string(), "https://*.example.com/".to_string()];
    assert!(is_network_request_allowed("https://api.github.com/repos", &patterns));
    assert!(is_network_request_allowed("https://a.example.com/x", &patterns));
    assert!(!is_network_request_allowed("http://api.github.com/", &patterns));
    assert!(!is_network_request_allowed("https://user:pw@api.github.com/", &patterns));
    assert!(!is_network_request_allowed("file:///etc/passwd", &patterns));
    assert!(!is_network_request_allowed("https://evil.com", &["*".to_string()]));
}

const COUNTER: &str = r#"
let count = (await api.storage.get("count")) ?? 0;
api.sidebar.registerView({
  id: "athas.counter.counter",
  title: "Counter",
  icon: "hash",
  render: () => api.ui.screen({ title: "Counter" },
    api.ui.metric({ label: "Clicks", value: count }),
    api.ui.button({ label: "Add one", variant: "accent", onClick: async () => { count += 1; await api.storage.set("count", count); } }),
    api.ui.form({ submitLabel: "Set", onSubmit: async (values) => { count = Number(values.amount); } },
      api.ui.input({ name: "amount", label: "Amount", value: String(count) })),
  ),
});
api.commands.register({ id: "athas.counter.reset", title: "Reset counter", run: () => { count = 0; api.views.invalidate("athas.counter.counter"); return "reset"; } });
"#;

fn host_with(limits: Limits, timeout: Duration) -> (Host, futures::channel::mpsc::UnboundedReceiver<HostEvent>, tempfile::TempDir) {
    let folder = tempfile::tempdir().unwrap();
    let services = Arc::new(HostServices::new(Some(folder.path().to_path_buf()), Arc::new(services::NoBridge), None));
    let (host, events) = Host::with_timeout(Arc::new(PlatformWorkers), services, limits, timeout);
    (host, events, folder)
}

/// Starts `code` (the body of `activate(api)`) as the extension `athas.<id>` and returns its id;
/// its contributions name themselves inside that namespace, as an installed extension's do.
fn load(host: &Host, id: &str, code: &str) -> String {
    let extension_id = format!("athas.{id}");
    let manifest = HostManifest { id: extension_id.clone(), name: id.into(), description: "A test extension".into(), ..Default::default() };
    let source = format!("export async function activate(api) {{\n\"use strict\";\n{code}\n}}\n");
    block_on(host.load(manifest, Some(source))).unwrap();
    extension_id
}

fn metric_value(node: &Node) -> String {
    let Node::Screen { children, .. } = node else { panic!("expected a screen") };
    match &children[0] {
        Node::Metric { value, .. } => value.to_string(),
        other => panic!("expected a metric, got {other:?}"),
    }
}

fn button_action(node: &Node) -> Action {
    let Node::Screen { children, .. } = node else { panic!("expected a screen") };
    match &children[1] {
        Node::Button { action, .. } => action.clone(),
        other => panic!("expected a button, got {other:?}"),
    }
}

#[test]
fn runs_a_sample_extension_and_round_trips_events() {
    let (host, _events, _folder) = host_with(Limits::default(), Duration::from_secs(10));
    let id = load(&host, "counter", COUNTER);
    let store = host.store();
    assert_eq!(store.extensions[&id].state, ExtensionState::Active);
    let view = &store.sidebar_views["athas.counter.counter"];
    assert_eq!((view.title.as_str(), view.icon.as_str()), ("Counter", "hash"));
    assert_eq!(store.commands["athas.counter.reset"].title, "Reset counter");

    let node = block_on(host.render_view(&id, &view.id)).unwrap();
    assert_eq!(metric_value(&node), "0");
    let action = button_action(&node);
    assert_eq!(action.command, "__generated.view.athas.counter.counter.inline.1");

    let revision = host.with_store(|store| store.revision(&view.id));
    block_on(host.execute_view_action(&id, &view.id, &action.command, action.arguments([]))).unwrap();
    assert_eq!(host.with_store(|store| store.revision(&view.id)), revision + 1, "a view action re-renders its view");
    let node = block_on(host.render_view(&id, &view.id)).unwrap();
    assert_eq!(metric_value(&node), "1");

    let Node::Screen { children, .. } = &node else { unreachable!() };
    let Node::Form { on_submit, .. } = &children[2] else { panic!("expected a form") };
    block_on(host.execute_view_action(&id, &view.id, &on_submit.command, on_submit.arguments([json!({ "amount": "41" })]))).unwrap();
    assert_eq!(metric_value(&block_on(host.render_view(&id, &view.id)).unwrap()), "41");

    assert_eq!(block_on(host.run_registered_command("athas.counter.reset", vec![])).unwrap(), json!("reset"));
    assert_eq!(metric_value(&block_on(host.render_view(&id, &view.id)).unwrap()), "0");
    assert!(block_on(host.run_registered_command("athas.other.x", vec![])).unwrap_err().contains("not available"));

    block_on(host.unload(&id));
    assert!(host.store().extensions.is_empty());
    assert!(block_on(host.render_view(&id, &view.id)).unwrap_err().contains("is not active"));
}

#[test]
fn storage_persists_across_reloads() {
    let (host, _events, _folder) = host_with(Limits::default(), Duration::from_secs(10));
    let id = load(&host, "counter", COUNTER);
    let view = "athas.counter.counter";
    let action = button_action(&block_on(host.render_view(&id, view)).unwrap());
    block_on(host.execute_view_action(&id, view, &action.command, vec![])).unwrap();
    block_on(host.unload(&id));
    load(&host, "counter", COUNTER);
    assert_eq!(metric_value(&block_on(host.render_view(&id, view)).unwrap()), "1");
}

#[test]
fn timers_run_inside_the_worker() {
    let (host, _events, _folder) = host_with(Limits::default(), Duration::from_secs(10));
    let code = r#"
let ticks = 0;
const interval = setInterval(() => { ticks += 1; if (ticks === 3) clearInterval(interval); }, 5);
// Waits for the third tick (however slow the machine), then a little longer: a cleared interval
// must not tick again.
api.commands.register({ id: "athas.timers.wait", run: () => new Promise((resolve) => {
  const check = () => (ticks >= 3 ? setTimeout(() => resolve(ticks), 30) : setTimeout(check, 5));
  check();
}) });
"#;
    let id = load(&host, "timers", code);
    assert_eq!(block_on(host.execute_command(&id, "athas.timers.wait", vec![])).unwrap(), json!(3));
}

#[test]
fn a_runaway_extension_is_stopped() {
    let limits = Limits { turn_budget: Duration::from_millis(200), ..Limits::default() };
    let (host, _events, _folder) = host_with(limits, Duration::from_secs(10));
    let code = r#"api.commands.register({ id: "athas.spin.spin", run: () => { for (;;) {} } });
api.commands.register({ id: "athas.spin.ok", run: () => 1 });"#;
    let id = load(&host, "spin", code);
    let started = std::time::Instant::now();
    let error = block_on(host.execute_command(&id, "athas.spin.spin", vec![])).unwrap_err();
    assert!(error.contains("time budget"), "{error}");
    assert!(started.elapsed() < Duration::from_secs(3));
    let registration = host.store().extensions[&id].clone();
    assert_eq!(registration.state, ExtensionState::Error);
    assert!(block_on(host.execute_command(&id, "athas.spin.ok", vec![])).unwrap_err().contains("is not active"));
}

#[test]
fn memory_is_capped() {
    let limits = Limits { memory_bytes: 16 * 1024 * 1024, ..Limits::default() };
    let (host, _events, _folder) = host_with(limits, Duration::from_secs(10));
    let code = r#"api.commands.register({ id: "athas.hog.hog", run: () => { const chunks = []; for (;;) chunks.push("x".repeat(1 << 20) + chunks.length); } });
api.commands.register({ id: "athas.hog.ok", run: () => "still here" });"#;
    let id = load(&host, "hog", code);
    let error = block_on(host.execute_command(&id, "athas.hog.hog", vec![])).unwrap_err();
    assert!(error.contains("out of memory"), "{error}");
    assert_eq!(block_on(host.execute_command(&id, "athas.hog.ok", vec![])).unwrap(), json!("still here"));
}

#[test]
fn extensions_are_isolated_and_sandboxed() {
    let (host, _events, _folder) = host_with(Limits::default(), Duration::from_secs(10));
    let first = load(&host, "first", r#"var shared = "first"; api.commands.register({ id: "athas.first.read", run: () => typeof shared });"#);
    let second = HostManifest { id: "athas.second".into(), name: "Second".into(), ..Default::default() };
    let source = r#"export function activate(api) {
  api.commands.register({ id: "athas.second.read", run: () => [typeof shared, typeof fetch, typeof postMessage, typeof navigator, typeof setTimeout].join() });
}"#;
    block_on(host.load(second, Some(source.into()))).unwrap();
    assert_eq!(block_on(host.execute_command(&first, "athas.first.read", vec![])).unwrap(), json!("string"));
    assert_eq!(block_on(host.execute_command("athas.second", "athas.second.read", vec![])).unwrap(), json!("undefined,undefined,undefined,undefined,function"));

    let manifest = HostManifest { id: "athas.sample".into(), name: "Sample".into(), ..Default::default() };
    let error = block_on(host.load(manifest.clone(), Some("import x from 'fs'; export function activate() {}".into()))).unwrap_err();
    assert!(error.contains("fs"), "{error}");
    let error = block_on(host.load(manifest.clone(), Some("export const nothing = 1;".into()))).unwrap_err();
    assert_eq!(error, "Integration must export activate(api)");
    assert_eq!(host.store().extensions["athas.sample"].state, ExtensionState::Error);
    let error = block_on(host.load(manifest, Some("export function activate(api) { api.sidebar.registerView({ id: 'other.view', render: () => null }); }".into())));
    assert!(error.is_ok());
    assert!(host.store().sidebar_views.is_empty(), "contribution ids outside the extension's namespace are refused");
}

#[test]
fn requests_time_out() {
    let (host, _events, _folder) = host_with(Limits::default(), Duration::from_millis(100));
    let id = load(&host, "slow", r#"api.commands.register({ id: "athas.slow.never", run: () => new Promise(() => {}) });"#);
    let request = host.execute_command(&id, "athas.slow.never", vec![]);
    std::thread::sleep(Duration::from_millis(150));
    host.expire_requests();
    assert_eq!(block_on(request).unwrap_err(), "Integration request timed out: executeCommand");
}

#[test]
fn host_calls_follow_permissions() {
    let (host, mut events, _folder) = host_with(Limits::default(), Duration::from_secs(10));
    let manifest = HostManifest { id: "athas.calls".into(), name: "Calls".into(), ..Default::default() };
    let source = r#"export function activate(api) {
  api.commands.register({ id: "athas.calls.http", run: () => api.http.request({ url: "https://example.com" }) });
  api.commands.register({ id: "athas.calls.clip", run: () => api.clipboard.writeText("x") });
  api.commands.register({ id: "athas.calls.notify", run: (n) => api.notifications.show({ title: "Hello " + n, tone: "success" }) });
}"#;
    block_on(host.load(manifest, Some(source.into()))).unwrap();
    assert_eq!(block_on(host.execute_command("athas.calls", "athas.calls.http", vec![])).unwrap_err(), "Integration does not have network permission");
    assert_eq!(block_on(host.execute_command("athas.calls", "athas.calls.clip", vec![])).unwrap_err(), "Integration does not have clipboard write permission");
    for n in 0..5 {
        block_on(host.execute_command("athas.calls", "athas.calls.notify", vec![json!(n)])).unwrap();
    }
    assert_eq!(block_on(host.execute_command("athas.calls", "athas.calls.notify", vec![json!(5)])).unwrap_err(), "Integration notification rate limit exceeded");
    let mut titles = Vec::new();
    while let Ok(event) = events.try_recv() {
        if let HostEvent::Notification { title, tone, .. } = event {
            assert_eq!(tone, "success");
            titles.push(title);
        }
    }
    assert_eq!(titles.len(), 5);
    assert_eq!(titles[0], "Hello 0");
}

#[test]
fn editor_settings_overrides_reach_the_app() {
    let (host, mut events, _folder) = host_with(Limits::default(), Duration::from_secs(10));
    let manifest = HostManifest { id: "athas.zoom".into(), name: "Zoom".into(), ..Default::default() };
    let source = r#"export function activate(api) {
  api.commands.register({ id: "athas.zoom.big", run: () => api.editor.updateSettings({ fontSize: 22 }) });
  api.commands.register({ id: "athas.zoom.reset", run: () => api.editor.clearSettingOverrides() });
  api.commands.register({ id: "athas.zoom.bad", run: () => api.editor.updateSettings(3) });
}"#;
    block_on(host.load(manifest, Some(source.into()))).unwrap();
    block_on(host.execute_command("athas.zoom", "athas.zoom.big", vec![])).unwrap();
    block_on(host.execute_command("athas.zoom", "athas.zoom.reset", vec![])).unwrap();
    assert_eq!(block_on(host.execute_command("athas.zoom", "athas.zoom.bad", vec![])).unwrap_err(), "Editor settings must be an object");
    let mut seen = Vec::new();
    while let Ok(event) = events.try_recv() {
        match event {
            HostEvent::EditorSettings(value) => seen.push(value),
            HostEvent::ClearEditorSettings => seen.push(json!("clear")),
            _ => {}
        }
    }
    assert_eq!(seen, vec![json!({ "fontSize": 22 }), json!("clear")]);
}

#[test]
fn ai_providers_must_be_contributed() {
    let (host, _events, _folder) = host_with(Limits::default(), Duration::from_secs(10));
    let manifest = HostManifest {
        id: "athas.provider".into(),
        name: "Provider".into(),
        ai_providers: vec![json!({ "id": "acme", "name": "Acme AI", "requiresApiKey": true, "models": [{ "id": "acme-1", "name": "Acme One" }, { "id": "" }] })],
        ..Default::default()
    };
    let source = r#"export function activate(api) {
  api.ai.registerProvider({ id: "acme", buildHeaders: (key) => ({ authorization: key }), buildPayload: (request) => request, validateApiKey: (key) => key === "ok" });
  api.commands.register({ id: "athas.provider.configure", run: () => "configured", palette: false });
  api.ai.registerSettingsAction({ id: "athas.provider.settings", providerId: "acme", label: "Acme account", buttonLabel: "Sign in", commandId: "athas.provider.configure" });
}"#;
    block_on(host.load(manifest, Some(source.into()))).unwrap();
    let store = host.store();
    assert_eq!(store.extensions["athas.provider"].state, ExtensionState::Active);
    let provider = &store.ai_providers[0];
    assert_eq!((provider.name().as_str(), provider.requires_api_key()), ("Acme AI", true));
    assert_eq!(provider.models(), vec![("acme-1".to_string(), "Acme One".to_string())]);
    let action = &store.ai_settings_actions[0];
    assert_eq!((action.id.as_str(), action.command_id.as_str(), action.button_label.as_str()), ("athas.provider.settings", "athas.provider.configure", "Sign in"));
    assert_eq!(block_on(host.ai_provider_request("acme", "validateApiKey", vec![json!("ok")])).unwrap(), json!(true));
    assert_eq!(block_on(host.ai_provider_request("acme", "getModels", vec![])).unwrap(), json!([]));
    assert!(block_on(host.ai_provider_request("other", "getModels", vec![])).unwrap_err().contains("not registered"));

    let stray = HostManifest { id: "athas.stray".into(), name: "Stray".into(), ..Default::default() };
    let source = r#"export function activate(api) {
  api.ai.registerProvider({ id: "acme", buildHeaders: () => ({}), buildPayload: (request) => request, validateApiKey: () => true });
}"#;
    block_on(host.load(stray, Some(source.into()))).unwrap();
    let providers = host.store().ai_providers;
    assert_eq!(providers.len(), 1, "an extension cannot take over a provider it does not contribute");
    assert_eq!(providers[0].extension_id, "athas.provider");
}
