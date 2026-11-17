//! A tap on agent processes' stdio for the ACP inspector: every line each way and the agent's
//! stderr, the newest [`MAX_ENTRIES`] per process, and the `initialize` exchange.
//!
//! Ported from Athas's `crates/ai/src/acp/traffic.rs` and the inspector's
//! `lib/acp-traffic-messages.ts`.

use std::{
    collections::{HashMap, VecDeque},
    sync::{
        Arc, Mutex, MutexGuard,
        atomic::{AtomicU64, Ordering},
    },
};

use serde_json::Value;

use super::traffic_secrets;

/// Entries kept per process.
pub const MAX_ENTRIES: usize = 2000;
/// Lines longer than this are cut, as a 64 KiB image would otherwise fill the log.
pub const MAX_LINE_BYTES: usize = 64 * 1024;
/// Stopped processes kept for the inspector.
const MAX_PROCESSES: usize = 12;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Direction {
    /// From the agent.
    In,
    /// To the agent.
    Out,
    Stderr,
}

impl Direction {
    pub fn label(self) -> &'static str {
        match self {
            Direction::In => "In",
            Direction::Out => "Out",
            Direction::Stderr => "Stderr",
        }
    }
}

#[derive(Clone, Debug)]
pub struct Entry {
    pub seq: u64,
    pub timestamp_ms: u64,
    pub direction: Direction,
    pub line: String,
    pub truncated: bool,
    /// The line's size before it was cut to `MAX_LINE_BYTES`.
    pub original_bytes: usize,
}

#[derive(Clone, Debug)]
pub struct Process {
    pub key: String,
    pub agent_id: String,
    pub agent_name: String,
    pub workspace: Option<String>,
    pub started_at_ms: u64,
    pub running: bool,
}

impl Process {
    pub fn label(&self) -> String {
        match self.workspace.as_deref().and_then(|path| path.rsplit(['/', '\\']).find(|part| !part.is_empty())) {
            Some(folder) => format!("{} in {folder}", self.agent_name),
            None => self.agent_name.clone(),
        }
    }
}

/// The `initialize` request and the agent's answer, as sent.
#[derive(Clone, Debug, Default)]
pub struct Initialize {
    pub request: Option<Value>,
    pub response: Option<Value>,
}

struct Log {
    process: Process,
    entries: VecDeque<Entry>,
    next_seq: u64,
    initialize: Initialize,
    initialize_id: Option<Value>,
}

#[derive(Default)]
struct Store {
    logs: Vec<Log>,
    next_key: u64,
}

static STORE: Mutex<Store> = Mutex::new(Store { logs: Vec::new(), next_key: 0 });
static REVISION: AtomicU64 = AtomicU64::new(0);

fn store() -> MutexGuard<'static, Store> {
    STORE.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn changed() {
    REVISION.fetch_add(1, Ordering::Relaxed);
}

/// Goes up whenever anything is recorded, so a view knows when to read again.
pub fn revision() -> u64 {
    REVISION.load(Ordering::Relaxed)
}

/// Records one agent process; dropping it marks the process stopped.
pub struct Tap {
    key: String,
    /// Values redacted wherever they appear, such as the API keys the agent starts with.
    secrets: Vec<String>,
}

impl Tap {
    pub fn start(agent_id: &str, agent_name: &str, workspace: Option<String>) -> Arc<Tap> {
        Self::start_with_secrets(agent_id, agent_name, workspace, Vec::new())
    }

    /// Like [`Tap::start`], also redacting `secrets` from every line.
    pub fn start_with_secrets(agent_id: &str, agent_name: &str, workspace: Option<String>, secrets: Vec<String>) -> Arc<Tap> {
        let mut store = store();
        store.next_key += 1;
        let key = format!("{agent_id}-{}", store.next_key);
        let process = Process {
            key: key.clone(),
            agent_id: agent_id.to_string(),
            agent_name: agent_name.to_string(),
            workspace,
            started_at_ms: workspace::now_ms(),
            running: true,
        };
        store.logs.push(Log { process, entries: VecDeque::new(), next_seq: 0, initialize: Initialize::default(), initialize_id: None });
        let stopped: Vec<usize> = store.logs.iter().enumerate().filter(|(_, log)| !log.process.running).map(|(index, _)| index).collect();
        if stopped.len() > MAX_PROCESSES {
            store.logs.remove(stopped[0]);
        }
        drop(store);
        changed();
        Arc::new(Tap { key, secrets })
    }

    pub fn record(&self, direction: Direction, line: &str) {
        let redacted = if direction == Direction::Stderr { None } else { traffic_secrets::redact_line(line) };
        let line = redacted.as_deref().unwrap_or(line);
        let scrubbed = traffic_secrets::scrub(line, &self.secrets);
        let line = scrubbed.as_deref().unwrap_or(line);
        let mut store = store();
        let Some(log) = store.logs.iter_mut().find(|log| log.process.key == self.key) else { return };
        let original_bytes = line.len();
        let truncated = original_bytes > MAX_LINE_BYTES;
        let line = if truncated { &line[..line.floor_char_boundary(MAX_LINE_BYTES)] } else { line };
        if !truncated && direction != Direction::Stderr {
            capture_initialize(log, direction, line);
        }
        log.entries.push_back(Entry { seq: log.next_seq, timestamp_ms: workspace::now_ms(), direction, line: line.to_string(), truncated, original_bytes });
        log.next_seq += 1;
        if log.entries.len() > MAX_ENTRIES {
            log.entries.pop_front();
        }
        drop(store);
        changed();
    }
}

impl Drop for Tap {
    fn drop(&mut self) {
        if let Some(log) = store().logs.iter_mut().find(|log| log.process.key == self.key) {
            log.process.running = false;
        }
        changed();
    }
}

fn capture_initialize(log: &mut Log, direction: Direction, line: &str) {
    if log.initialize.response.is_some() {
        return;
    }
    let Ok(message) = serde_json::from_str::<Value>(line) else { return };
    match direction {
        Direction::Out if message.get("method").and_then(Value::as_str) == Some("initialize") => {
            log.initialize_id = message.get("id").cloned();
            log.initialize.request = Some(message);
        }
        Direction::In if log.initialize_id.is_some() && message.get("method").is_none() && message.get("id") == log.initialize_id.as_ref() => {
            log.initialize.response = Some(message);
        }
        _ => {}
    }
}

/// Every recorded process, running ones first, newest first.
pub fn processes() -> Vec<Process> {
    let mut processes: Vec<Process> = store().logs.iter().map(|log| log.process.clone()).collect();
    processes.sort_by(|a, b| b.running.cmp(&a.running).then(b.started_at_ms.cmp(&a.started_at_ms)));
    processes
}

/// A process's recorded lines and `initialize` exchange.
pub fn backlog(key: &str) -> Option<(Vec<Entry>, Initialize)> {
    store().logs.iter().find(|log| log.process.key == key).map(|log| (log.entries.iter().cloned().collect(), log.initialize.clone()))
}

/// A process's log as JSON Lines (`exportAcpTraffic`): a `process` line with the
/// `initialize` exchange, then one `entry` line per recorded line, parsed when it is whole JSON.
pub fn export(key: &str) -> Option<String> {
    let store = store();
    let log = store.logs.iter().find(|log| log.process.key == key)?;
    let process = &log.process;
    let mut out = serde_json::json!({
        "type": "process",
        "exportedAtMs": workspace::now_ms(),
        "process": {
            "processKey": process.key,
            "agentId": process.agent_id,
            "agentName": process.agent_name,
            "workspacePath": process.workspace,
            "running": process.running,
            "startedAtMs": process.started_at_ms,
            "entryCount": log.entries.len(),
        },
        "initialize": { "request": log.initialize.request, "response": log.initialize.response },
    })
    .to_string();
    out.push('\n');
    for entry in &log.entries {
        let message = if entry.direction != Direction::Stderr && !entry.truncated {
            serde_json::from_str(&entry.line).unwrap_or_else(|_| Value::String(entry.line.clone()))
        } else {
            Value::String(entry.line.clone())
        };
        let direction = match entry.direction {
            Direction::In => "in",
            Direction::Out => "out",
            Direction::Stderr => "stderr",
        };
        out.push_str(
            &serde_json::json!({
                "type": "entry",
                "seq": entry.seq,
                "timestampMs": entry.timestamp_ms,
                "direction": direction,
                "truncated": entry.truncated,
                "originalBytes": entry.original_bytes,
                "message": message,
            })
            .to_string(),
        );
        out.push('\n');
    }
    Some(out)
}

/// `acp-{agent}-{UTC time}.jsonl`, as the original names an export.
pub fn export_file_name(agent_id: &str, now_ms: u64) -> String {
    let stamp = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(now_ms as i64).map(|time| time.format("%Y-%m-%dT%H-%M-%S-%3fZ").to_string()).unwrap_or_default();
    format!("acp-{agent_id}-{stamp}.jsonl")
}

pub fn clear(key: &str) {
    if let Some(log) = store().logs.iter_mut().find(|log| log.process.key == key) {
        log.entries.clear();
    }
    changed();
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Request,
    Response,
    Notification,
    Stderr,
    Unknown,
}

impl Kind {
    pub fn label(self) -> &'static str {
        match self {
            Kind::Request => "request",
            Kind::Response => "response",
            Kind::Notification => "notification",
            Kind::Stderr => "stderr",
            Kind::Unknown => "unknown",
        }
    }

    fn of(has_method: bool, has_id: bool) -> Kind {
        match (has_method, has_id) {
            (true, true) => Kind::Request,
            (true, false) => Kind::Notification,
            (false, true) => Kind::Response,
            (false, false) => Kind::Unknown,
        }
    }
}

/// One JSON-RPC message (or stderr line); a batch line yields several.
#[derive(Clone, Debug)]
pub struct Message {
    pub key: String,
    pub timestamp_ms: u64,
    pub direction: Direction,
    pub kind: Kind,
    /// The method, taken from the matching request for a response.
    pub method: Option<String>,
    /// The JSON-RPC id as JSON text, so numbers and strings stay apart.
    pub id: Option<String>,
    pub session_id: Option<String>,
    pub payload: Option<Value>,
    pub raw: String,
    pub truncated: bool,
    pub is_error: bool,
    /// For a request, its response; for a response, its request.
    pub partner: Option<String>,
    pub latency_ms: Option<u64>,
}

fn session_id_of(message: &Value) -> Option<String> {
    ["params", "result"].iter().find_map(|field| message.get(*field)?.get("sessionId")?.as_str().map(str::to_string))
}

fn parse_entry(entry: &Entry) -> Vec<Message> {
    let key = entry.seq.to_string();
    let base = |key: String, kind: Kind| Message {
        key,
        timestamp_ms: entry.timestamp_ms,
        direction: entry.direction,
        kind,
        method: None,
        id: None,
        session_id: None,
        payload: None,
        raw: entry.line.clone(),
        truncated: entry.truncated,
        is_error: false,
        partner: None,
        latency_ms: None,
    };
    if entry.direction == Direction::Stderr {
        return vec![base(key, Kind::Stderr)];
    }
    if entry.truncated {
        return vec![base(key, Kind::Unknown)];
    }
    let parsed = serde_json::from_str::<Value>(&entry.line).ok();
    let items = match parsed {
        Some(Value::Array(items)) => items,
        Some(item) => vec![item],
        None => return vec![base(key, Kind::Unknown)],
    };
    let batch = items.len() > 1;
    items
        .into_iter()
        .enumerate()
        .map(|(index, item)| {
            let item_key = if batch { format!("{key}.{index}") } else { key.clone() };
            let Some(object) = item.as_object() else {
                let mut message = base(item_key, Kind::Unknown);
                message.payload = Some(item);
                return message;
            };
            let method = object.get("method").and_then(Value::as_str).map(str::to_string);
            let id = object.get("id").map(Value::to_string);
            let mut message = base(item_key, Kind::of(method.is_some(), id.is_some()));
            if batch {
                message.raw = item.to_string();
            }
            message.is_error = object.contains_key("error");
            message.session_id = session_id_of(&item);
            message.method = method;
            message.id = id;
            message.payload = Some(item);
            message
        })
        .collect()
}

/// Parses recorded entries in order and pairs each response with the request it answers: it
/// travels the other way with the same id, and takes the request's method and session.
pub fn messages(entries: &[Entry]) -> Vec<Message> {
    let mut messages: Vec<Message> = entries.iter().flat_map(parse_entry).collect();
    let mut pending: HashMap<(Direction, String), usize> = HashMap::new();
    for index in 0..messages.len() {
        let Some(id) = messages[index].id.clone() else { continue };
        match messages[index].kind {
            Kind::Request => {
                pending.insert((messages[index].direction, id), index);
            }
            Kind::Response => {
                let request_direction = if messages[index].direction == Direction::In { Direction::Out } else { Direction::In };
                let Some(request) = pending.remove(&(request_direction, id)) else { continue };
                let latency = messages[index].timestamp_ms.saturating_sub(messages[request].timestamp_ms);
                let (request_key, response_key) = (messages[request].key.clone(), messages[index].key.clone());
                let (method, session) = (messages[request].method.clone(), messages[request].session_id.clone());
                messages[request].partner = Some(response_key);
                messages[request].latency_ms = Some(latency);
                let response = &mut messages[index];
                response.partner = Some(request_key);
                response.latency_ms = Some(latency);
                response.method = response.method.take().or(method);
                response.session_id = response.session_id.take().or(session);
            }
            _ => {}
        }
    }
    messages
}

/// Which messages the log shows.
#[derive(Clone, Debug, Default)]
pub struct Filter {
    pub query: String,
    pub direction: Option<Direction>,
    pub session_id: Option<String>,
}

pub fn filter<'a>(messages: &'a [Message], filter: &Filter) -> Vec<&'a Message> {
    let query = filter.query.trim().to_lowercase();
    messages
        .iter()
        .filter(|message| filter.direction.is_none_or(|direction| message.direction == direction))
        .filter(|message| filter.session_id.is_none() || message.session_id == filter.session_id)
        .filter(|message| {
            query.is_empty()
                || message.method.as_deref().is_some_and(|method| method.to_lowercase().contains(&query))
                || message.id.as_deref().is_some_and(|id| id.to_lowercase() == query)
                || (message.kind == Kind::Stderr && message.raw.to_lowercase().contains(&query))
        })
        .collect()
}

/// Session ids seen in the traffic, in first-seen order.
pub fn session_ids(messages: &[Message]) -> Vec<String> {
    let mut ids: Vec<String> = Vec::new();
    for id in messages.iter().filter_map(|message| message.session_id.as_ref()) {
        if !ids.contains(id) {
            ids.push(id.clone());
        }
    }
    ids
}

/// The message as copied: pretty JSON when it parsed, the raw line otherwise.
pub fn format_message(message: &Message) -> String {
    match &message.payload {
        Some(payload) => serde_json::to_string_pretty(payload).unwrap_or_else(|_| message.raw.clone()),
        None => message.raw.clone(),
    }
}

/// `HH:MM:SS.mmm` of a timestamp, in UTC.
pub fn format_time(timestamp_ms: u64) -> String {
    let millis = timestamp_ms % 1000;
    let seconds = timestamp_ms / 1000;
    format!("{:02}:{:02}:{:02}.{millis:03}", (seconds / 3600) % 24, (seconds / 60) % 60, seconds % 60)
}

/// Every message as "Copy all" copies them: a header line per message, then its body.
pub fn format_messages(messages: &[&Message]) -> String {
    messages
        .iter()
        .map(|message| {
            let direction = match message.direction {
                Direction::In => "agent -> client",
                Direction::Out => "client -> agent",
                Direction::Stderr => "stderr",
            };
            let label = [Some(direction), Some(message.kind.label()), message.method.as_deref()].into_iter().flatten().collect::<Vec<_>>().join(" ");
            let id = message.id.as_ref().map(|id| format!(" #{id}")).unwrap_or_default();
            format!("[{}] {label}{id}\n{}", format_time(message.timestamp_ms), format_message(message))
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// What the Capabilities tab shows from the `initialize` exchange, as `(title, value)`.
pub fn initialize_summary(exchange: &Initialize) -> Vec<(&'static str, Option<Value>)> {
    let params = exchange.request.as_ref().and_then(|request| request.get("params"));
    let result = exchange.response.as_ref().and_then(|response| response.get("result"));
    let from = |value: Option<&Value>, key: &str| value.and_then(|value| value.get(key)).cloned();
    vec![
        ("Initialize error", exchange.response.as_ref().and_then(|response| response.get("error")).cloned()),
        ("Protocol version", from(result, "protocolVersion").or_else(|| from(params, "protocolVersion"))),
        ("Agent info", from(result, "agentInfo")),
        ("Agent capabilities", from(result, "agentCapabilities")),
        ("Auth methods", from(result, "authMethods")),
        ("Client info", from(params, "clientInfo")),
        ("Client capabilities", from(params, "clientCapabilities")),
        ("Initialize request", exchange.request.clone()),
        ("Initialize response", exchange.response.clone()),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exports_parsed_messages_as_json_lines() {
        let tap = Tap::start("export-test", "Export", Some("/code".into()));
        tap.record(Direction::Out, r#"{"jsonrpc":"2.0","id":1,"method":"x"}"#);
        tap.record(Direction::Stderr, "warning");
        let key = processes().into_iter().find(|process| process.agent_id == "export-test").unwrap().key;
        let export = export(&key).unwrap();
        let lines: Vec<Value> = export.lines().map(|line| serde_json::from_str(line).unwrap()).collect();
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0]["type"], "process");
        assert_eq!(lines[0]["process"]["agentId"], "export-test");
        assert_eq!(lines[1]["direction"], "out");
        assert_eq!(lines[1]["message"]["method"], "x");
        assert_eq!(lines[2]["message"], "warning");
        assert_eq!(export_file_name("claude", 0), "acp-claude-1970-01-01T00-00-00-000Z.jsonl");
    }

    fn entry(seq: u64, timestamp_ms: u64, direction: Direction, line: &str) -> Entry {
        Entry { seq, timestamp_ms, direction, line: line.to_string(), truncated: false, original_bytes: line.len() }
    }

    #[test]
    fn responses_pair_with_their_requests() {
        let entries = [
            entry(0, 10, Direction::Out, r#"{"jsonrpc":"2.0","id":1,"method":"session/prompt","params":{"sessionId":"s1"}}"#),
            entry(1, 12, Direction::In, r#"{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s1"}}"#),
            entry(2, 25, Direction::In, r#"{"jsonrpc":"2.0","id":1,"result":{"stopReason":"end_turn"}}"#),
            entry(3, 26, Direction::Stderr, "warning: slow"),
        ];
        let messages = messages(&entries);
        assert_eq!(messages[0].kind, Kind::Request);
        assert_eq!(messages[0].partner.as_deref(), Some("2"));
        assert_eq!(messages[1].kind, Kind::Notification);
        assert_eq!(messages[2].method.as_deref(), Some("session/prompt"));
        assert_eq!(messages[2].session_id.as_deref(), Some("s1"));
        assert_eq!(messages[2].latency_ms, Some(15));
        assert_eq!(session_ids(&messages), vec!["s1".to_string()]);
        let only_stderr = filter(&messages, &Filter { direction: Some(Direction::Stderr), ..Default::default() });
        assert_eq!(only_stderr.len(), 1);
        assert_eq!(filter(&messages, &Filter { query: "prompt".into(), ..Default::default() }).len(), 2);
        assert_eq!(filter(&messages, &Filter { query: "slow".into(), ..Default::default() }).len(), 1);
    }

    #[test]
    fn a_tap_keeps_the_initialize_exchange_and_stops_on_drop() {
        let tap = Tap::start("test-agent", "Test Agent", Some("/work/athas".into()));
        tap.record(Direction::Out, r#"{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":1,"clientInfo":{"name":"athas"}}}"#);
        tap.record(Direction::In, r#"{"jsonrpc":"2.0","id":0,"result":{"protocolVersion":1,"agentCapabilities":{"loadSession":true}}}"#);
        tap.record(Direction::Stderr, &"x".repeat(MAX_LINE_BYTES + 10));
        let key = tap.key.clone();
        let (entries, initialize) = backlog(&key).unwrap();
        assert_eq!(entries.len(), 3);
        assert!(entries[2].truncated);
        let summary = initialize_summary(&initialize);
        assert_eq!(summary[3].1, Some(serde_json::json!({ "loadSession": true })));
        let process = processes().into_iter().find(|process| process.key == key).unwrap();
        assert!(process.running);
        assert_eq!(process.label(), "Test Agent in athas");
        drop(tap);
        assert!(!processes().into_iter().find(|process| process.key == key).unwrap().running);
    }
}
