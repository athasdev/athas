//! The ACP traffic inspector: a tap on each agent process's stdio that keeps the JSON-RPC lines
//! it sent and received, and what it wrote to stderr, in a bounded log per process.
//!
//! Every process is always recorded. The cost per line is one copy into a ring buffer under a
//! short lock, bounded by [`MAX_ENTRIES`] and [`MAX_LOG_BYTES`], so the log is there when
//! something already went wrong and the user opens the inspector afterwards. Lines are parsed
//! only when they have to be: to redact MCP server secrets, to summarize a line that is cut
//! short, and to capture `initialize`. Live entries are pushed to the frontend only while an
//! inspector is subscribed.

use super::traffic_secrets::{REDACTED, scrub};
use agent_client_protocol as acp_sdk;
use futures::{AsyncBufReadExt, AsyncWrite, AsyncWriteExt, Stream, StreamExt, io::BufReader};
use serde::Serialize;
use serde_json::Value;
use std::{
   collections::{HashMap, VecDeque},
   io,
   path::Path,
   sync::{
      Arc, Mutex,
      atomic::{AtomicU64, AtomicUsize, Ordering},
   },
   time::{SystemTime, UNIX_EPOCH},
};

/// How many entries a process keeps before the oldest are dropped.
pub(super) const MAX_ENTRIES: usize = 2000;
/// How many bytes of lines a process keeps before the oldest are dropped.
pub(super) const MAX_LOG_BYTES: usize = 8 * 1024 * 1024;
/// Longer lines are cut to this many bytes and marked truncated.
pub(super) const MAX_LINE_BYTES: usize = 64 * 1024;
/// Stopped processes kept for inspection after more than this many logs exist.
const MAX_LOGS: usize = 16;

/// Which way a line went.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TrafficDirection {
   /// From the agent to Athas.
   In,
   /// From Athas to the agent.
   Out,
   /// A line the agent wrote to stderr.
   Stderr,
}

/// One recorded line.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrafficEntry {
   /// Increases by one per entry in a process's log.
   pub seq: u64,
   pub timestamp_ms: u64,
   pub direction: TrafficDirection,
   /// The line as sent, with secrets redacted and cut to [`MAX_LINE_BYTES`].
   pub line: String,
   pub truncated: bool,
   /// Byte length of the line before it was cut.
   pub original_bytes: usize,
   /// For a truncated line, which can no longer be parsed, the method it carried.
   #[serde(skip_serializing_if = "Option::is_none")]
   pub method: Option<String>,
   /// For a truncated line, the JSON-RPC id it carried.
   #[serde(skip_serializing_if = "Option::is_none")]
   pub id: Option<Value>,
}

/// The `initialize` exchange of a process, kept apart from the ring buffer so it is never
/// dropped.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeExchange {
   pub request: Option<Value>,
   pub response: Option<Value>,
}

/// A process the inspector has a log for.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrafficProcess {
   pub process_key: String,
   pub agent_id: String,
   pub agent_name: String,
   pub workspace_path: Option<String>,
   pub running: bool,
   pub started_at_ms: u64,
   pub entry_count: usize,
}

/// Everything recorded for one process.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrafficBacklog {
   pub process: TrafficProcess,
   pub initialize: InitializeExchange,
   pub entries: Vec<TrafficEntry>,
}

/// What a subscribed inspector is told.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TrafficEvent {
   #[serde(rename_all = "camelCase")]
   Entry {
      process_key: String,
      entry: TrafficEntry,
   },
   #[serde(rename_all = "camelCase")]
   Process { process: TrafficProcess },
   #[serde(rename_all = "camelCase")]
   Initialize {
      process_key: String,
      initialize: InitializeExchange,
   },
}

type Emitter = Arc<dyn Fn(TrafficEvent) + Send + Sync>;

struct ProcessLog {
   /// Tells this process apart from an earlier one under the same key, whose tap may still be
   /// winding down.
   generation: u64,
   agent_id: String,
   agent_name: String,
   workspace_path: Option<String>,
   running: bool,
   started_at_ms: u64,
   entries: VecDeque<TrafficEntry>,
   bytes: usize,
   next_seq: u64,
   initialize: InitializeExchange,
   /// The id of the `initialize` request while its response has not arrived.
   pending_initialize_id: Option<Value>,
}

impl ProcessLog {
   fn summary(&self, process_key: &str) -> TrafficProcess {
      TrafficProcess {
         process_key: process_key.to_string(),
         agent_id: self.agent_id.clone(),
         agent_name: self.agent_name.clone(),
         workspace_path: self.workspace_path.clone(),
         running: self.running,
         started_at_ms: self.started_at_ms,
         entry_count: self.entries.len(),
      }
   }

   fn push(&mut self, mut entry: TrafficEntry) -> TrafficEntry {
      entry.seq = self.next_seq;
      self.next_seq += 1;
      self.bytes += entry.line.len();
      self.entries.push_back(entry.clone());
      while self.entries.len() > MAX_ENTRIES || self.bytes > MAX_LOG_BYTES {
         let Some(dropped) = self.entries.pop_front() else {
            break;
         };
         self.bytes -= dropped.line.len();
      }
      entry
   }

   /// Keeps the `initialize` request and its response when `line` is one of them. Returns
   /// whether the exchange changed.
   fn capture_initialize(&mut self, direction: TrafficDirection, line: &str) -> bool {
      match direction {
         TrafficDirection::Out if self.initialize.request.is_none() => {
            if !line.contains("\"initialize\"") {
               return false;
            }
            let Ok(value) = serde_json::from_str::<Value>(line) else {
               return false;
            };
            if value.get("method").and_then(Value::as_str) != Some("initialize") {
               return false;
            }
            self.pending_initialize_id = value.get("id").cloned();
            self.initialize.request = Some(value);
            true
         }
         TrafficDirection::In => {
            let Some(pending) = &self.pending_initialize_id else {
               return false;
            };
            let Ok(value) = serde_json::from_str::<Value>(line) else {
               return false;
            };
            if value.get("method").is_some() || value.get("id") != Some(pending) {
               return false;
            }
            self.pending_initialize_id = None;
            self.initialize.response = Some(value);
            true
         }
         _ => false,
      }
   }
}

#[derive(Default)]
struct InspectorState {
   logs: HashMap<String, ProcessLog>,
}

struct Inner {
   state: Mutex<InspectorState>,
   subscribers: AtomicUsize,
   next_generation: AtomicU64,
   emitter: Mutex<Option<Emitter>>,
}

/// Every agent process's traffic log. Cheap to clone.
#[derive(Clone)]
pub struct TrafficInspector {
   inner: Arc<Inner>,
}

impl Default for TrafficInspector {
   fn default() -> Self {
      Self {
         inner: Arc::new(Inner {
            state: Mutex::default(),
            subscribers: AtomicUsize::new(0),
            next_generation: AtomicU64::new(0),
            emitter: Mutex::new(None),
         }),
      }
   }
}

/// The key a process's log is kept under: one per agent and workspace, like the processes.
pub(super) fn process_key(agent_id: &str, workspace_path: Option<&Path>) -> String {
   match workspace_path {
      Some(path) => format!("{agent_id}@{}", path.to_string_lossy()),
      None => agent_id.to_string(),
   }
}

fn now_ms() -> u64 {
   SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .map(|elapsed| elapsed.as_millis() as u64)
      .unwrap_or_default()
}

impl TrafficInspector {
   /// Sets where live events go while an inspector is subscribed.
   pub fn set_emitter(&self, emitter: impl Fn(TrafficEvent) + Send + Sync + 'static) {
      *lock(&self.inner.emitter) = Some(Arc::new(emitter));
   }

   /// An inspector opened: live events start flowing.
   pub fn subscribe(&self) {
      self.inner.subscribers.fetch_add(1, Ordering::AcqRel);
   }

   /// An inspector closed: live events stop once none is left.
   pub fn unsubscribe(&self) {
      let _ = self
         .inner
         .subscribers
         .fetch_update(Ordering::AcqRel, Ordering::Acquire, |count| {
            Some(count.saturating_sub(1))
         });
   }

   fn emit(&self, event: impl FnOnce() -> TrafficEvent) {
      if self.inner.subscribers.load(Ordering::Acquire) == 0 {
         return;
      }
      let emitter = lock(&self.inner.emitter).clone();
      if let Some(emitter) = emitter {
         emitter(event());
      }
   }

   /// Starts the log of a new process. A process that replaces an earlier one for the same agent
   /// and workspace starts from an empty log, since its request ids start over.
   /// `secrets` are values redacted wherever they appear in its lines, such as the API keys it
   /// was started with.
   pub(super) fn start_process(
      &self,
      agent_id: &str,
      agent_name: &str,
      workspace_path: Option<&Path>,
      secrets: Vec<String>,
   ) -> TrafficTap {
      let key = process_key(agent_id, workspace_path);
      let generation = self.inner.next_generation.fetch_add(1, Ordering::Relaxed);
      let summary = {
         let mut state = lock(&self.inner.state);
         let log = ProcessLog {
            generation,
            agent_id: agent_id.to_string(),
            agent_name: agent_name.to_string(),
            workspace_path: workspace_path.map(|path| path.to_string_lossy().into_owned()),
            running: true,
            started_at_ms: now_ms(),
            entries: VecDeque::new(),
            bytes: 0,
            next_seq: 0,
            initialize: InitializeExchange::default(),
            pending_initialize_id: None,
         };
         let summary = log.summary(&key);
         state.logs.insert(key.clone(), log);
         prune_stopped(&mut state.logs);
         summary
      };
      self.emit(|| TrafficEvent::Process { process: summary });
      TrafficTap {
         inspector: self.clone(),
         key: Arc::from(key),
         generation,
         secrets: Arc::from(secrets),
      }
   }

   fn record(
      &self,
      key: &str,
      generation: u64,
      secrets: &[String],
      direction: TrafficDirection,
      line: &str,
   ) {
      let (entry, initialize) = {
         let mut state = lock(&self.inner.state);
         let Some(log) = state
            .logs
            .get_mut(key)
            .filter(|log| log.generation == generation)
         else {
            return;
         };
         let initialize = log
            .capture_initialize(direction, line)
            .then(|| log.initialize.clone());
         (
            log.push(prepare_entry(direction, line, secrets)),
            initialize,
         )
      };
      if let Some(initialize) = initialize {
         self.emit(|| TrafficEvent::Initialize {
            process_key: key.to_string(),
            initialize,
         });
      }
      self.emit(|| TrafficEvent::Entry {
         process_key: key.to_string(),
         entry,
      });
   }

   fn mark_stopped(&self, key: &str, generation: u64) {
      let summary = {
         let mut state = lock(&self.inner.state);
         let Some(log) = state
            .logs
            .get_mut(key)
            .filter(|log| log.generation == generation)
         else {
            return;
         };
         if !log.running {
            return;
         }
         log.running = false;
         log.summary(key)
      };
      self.emit(|| TrafficEvent::Process { process: summary });
   }

   /// Every process with a log, running ones first.
   pub fn processes(&self) -> Vec<TrafficProcess> {
      let state = lock(&self.inner.state);
      let mut processes: Vec<_> = state
         .logs
         .iter()
         .map(|(key, log)| log.summary(key))
         .collect();
      processes.sort_by(|a, b| {
         b.running
            .cmp(&a.running)
            .then(b.started_at_ms.cmp(&a.started_at_ms))
      });
      processes
   }

   /// Everything recorded for a process.
   pub fn backlog(&self, process_key: &str) -> Option<TrafficBacklog> {
      let state = lock(&self.inner.state);
      let log = state.logs.get(process_key)?;
      Some(TrafficBacklog {
         process: log.summary(process_key),
         initialize: log.initialize.clone(),
         entries: log.entries.iter().cloned().collect(),
      })
   }

   /// Drops a process's recorded lines. Its `initialize` exchange stays.
   pub fn clear(&self, process_key: &str) {
      let mut state = lock(&self.inner.state);
      if let Some(log) = state.logs.get_mut(process_key) {
         log.entries.clear();
         log.bytes = 0;
      }
   }

   /// A process's log as JSON Lines: a header with the process and its `initialize` exchange,
   /// then one line per entry with the message parsed where it can be.
   pub fn export(&self, process_key: &str) -> Option<String> {
      let backlog = self.backlog(process_key)?;
      let mut out = serde_json::to_string(&serde_json::json!({
         "type": "process",
         "exportedAtMs": now_ms(),
         "process": backlog.process,
         "initialize": backlog.initialize,
      }))
      .ok()?;
      out.push('\n');
      for entry in backlog.entries {
         let message = if entry.direction != TrafficDirection::Stderr && !entry.truncated {
            serde_json::from_str(&entry.line).unwrap_or(Value::String(entry.line.clone()))
         } else {
            Value::String(entry.line.clone())
         };
         let line = serde_json::json!({
            "type": "entry",
            "seq": entry.seq,
            "timestampMs": entry.timestamp_ms,
            "direction": entry.direction,
            "truncated": entry.truncated,
            "originalBytes": entry.original_bytes,
            "message": message,
         });
         out.push_str(&line.to_string());
         out.push('\n');
      }
      Some(out)
   }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
   mutex
      .lock()
      .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Drops the oldest stopped logs once there are more than [`MAX_LOGS`].
fn prune_stopped(logs: &mut HashMap<String, ProcessLog>) {
   while logs.len() > MAX_LOGS {
      let Some(oldest) = logs
         .iter()
         .filter(|(_, log)| !log.running)
         .min_by_key(|(_, log)| log.started_at_ms)
         .map(|(key, _)| key.clone())
      else {
         return;
      };
      logs.remove(&oldest);
   }
}

/// Builds the entry kept for `line`: secrets redacted, then cut to [`MAX_LINE_BYTES`].
fn prepare_entry(direction: TrafficDirection, line: &str, secrets: &[String]) -> TrafficEntry {
   let redacted = if direction == TrafficDirection::Stderr {
      None
   } else {
      redact_line(line)
   };
   let line = redacted.as_deref().unwrap_or(line);
   let scrubbed = scrub(line, secrets);
   let line = scrubbed.as_deref().unwrap_or(line);
   let original_bytes = line.len();
   let truncated = original_bytes > MAX_LINE_BYTES;
   let (method, id) = if truncated && direction != TrafficDirection::Stderr {
      summarize(line)
   } else {
      (None, None)
   };
   let kept = if truncated {
      let mut end = MAX_LINE_BYTES;
      while !line.is_char_boundary(end) {
         end -= 1;
      }
      &line[..end]
   } else {
      line
   };
   TrafficEntry {
      seq: 0,
      timestamp_ms: now_ms(),
      direction,
      line: kept.to_string(),
      truncated,
      original_bytes,
      method,
      id,
   }
}

/// The method and id of a message too long to keep whole, so the inspector can still pair it.
fn summarize(line: &str) -> (Option<String>, Option<Value>) {
   let Ok(value) = serde_json::from_str::<Value>(line) else {
      return (None, None);
   };
   let message = match &value {
      Value::Array(items) => items.first().unwrap_or(&Value::Null),
      other => other,
   };
   (
      message
         .get("method")
         .and_then(Value::as_str)
         .map(str::to_string),
      message.get("id").cloned(),
   )
}

/// Returns `line` with the MCP server secrets Athas sends in session setup (stdio `env` values
/// and HTTP/SSE `headers` values) replaced, or `None` when it carries none.
fn redact_line(line: &str) -> Option<String> {
   if !line.contains("\"mcpServers\"") {
      return None;
   }
   let mut value = serde_json::from_str::<Value>(line).ok()?;
   let changed = match &mut value {
      // Every entry is redacted, so this counts rather than stopping at the first change.
      Value::Array(items) => items.iter_mut().map(redact_message).filter(|&c| c).count() > 0,
      message => redact_message(message),
   };
   changed.then(|| value.to_string())
}

fn redact_message(message: &mut Value) -> bool {
   let Some(servers) = message
      .get_mut("params")
      .and_then(|params| params.get_mut("mcpServers"))
      .and_then(Value::as_array_mut)
   else {
      return false;
   };
   let mut changed = false;
   for server in servers {
      for field in ["env", "headers"] {
         let Some(pairs) = server.get_mut(field).and_then(Value::as_array_mut) else {
            continue;
         };
         for pair in pairs {
            if let Some(value) = pair.get_mut("value") {
               *value = Value::String(REDACTED.to_string());
               changed = true;
            }
         }
      }
   }
   changed
}

/// Records one process's traffic into its log.
#[derive(Clone)]
pub(super) struct TrafficTap {
   inspector: TrafficInspector,
   key: Arc<str>,
   generation: u64,
   secrets: Arc<[String]>,
}

impl TrafficTap {
   pub(super) fn record(&self, direction: TrafficDirection, line: &str) {
      self
         .inspector
         .record(&self.key, self.generation, &self.secrets, direction, line);
   }
}

/// Marks the process stopped once the transport reading its stdout is dropped.
struct StopOnDrop(TrafficTap);

impl Drop for StopOnDrop {
   fn drop(&mut self) {
      self
         .0
         .inspector
         .mark_stopped(&self.0.key, self.0.generation);
   }
}

/// The same newline-delimited transport as [`acp_sdk::ByteStreams`], with every line going
/// either way recorded by `tap`.
pub(super) fn tapped_transport<W, R>(
   outgoing: W,
   incoming: R,
   tap: TrafficTap,
) -> acp_sdk::Lines<
   impl futures::Sink<String, Error = io::Error> + Send + 'static,
   impl Stream<Item = io::Result<String>> + Send + 'static,
>
where
   W: AsyncWrite + Send + 'static,
   R: futures::AsyncRead + Send + 'static,
{
   let (outgoing, incoming) = tapped_lines(outgoing, incoming, tap);
   acp_sdk::Lines::new(outgoing, incoming)
}

fn tapped_lines<W, R>(
   outgoing: W,
   incoming: R,
   tap: TrafficTap,
) -> (
   impl futures::Sink<String, Error = io::Error> + Send + 'static,
   impl Stream<Item = io::Result<String>> + Send + 'static,
)
where
   W: AsyncWrite + Send + 'static,
   R: futures::AsyncRead + Send + 'static,
{
   let incoming_tap = StopOnDrop(tap.clone());
   let incoming = Box::pin(BufReader::new(incoming).lines()).inspect(move |line| {
      if let Ok(line) = line {
         incoming_tap.0.record(TrafficDirection::In, line);
      }
   });
   let outgoing = futures::sink::unfold(
      (Box::pin(outgoing), tap),
      async move |(mut writer, tap), line: String| {
         tap.record(TrafficDirection::Out, &line);
         let mut bytes = line.into_bytes();
         bytes.push(b'\n');
         writer.write_all(&bytes).await?;
         writer.flush().await?;
         Ok::<_, io::Error>((writer, tap))
      },
   );
   (outgoing, incoming)
}

#[cfg(test)]
mod tests {
   use super::*;
   use serde_json::json;

   fn inspector_with_process() -> (TrafficInspector, TrafficTap, String) {
      let inspector = TrafficInspector::default();
      let tap = inspector.start_process(
         "agent",
         "Agent",
         Some(Path::new("/work")),
         vec!["env-secret-123".to_string()],
      );
      (inspector, tap, "agent@/work".to_string())
   }

   #[test]
   fn keeps_at_most_max_entries() {
      let (inspector, tap, key) = inspector_with_process();
      for index in 0..MAX_ENTRIES + 5 {
         tap.record(TrafficDirection::Stderr, &format!("line {index}"));
      }
      let backlog = inspector.backlog(&key).unwrap();
      assert_eq!(backlog.entries.len(), MAX_ENTRIES);
      assert_eq!(backlog.entries[0].line, "line 5");
      assert_eq!(backlog.entries[0].seq, 5);
   }

   #[test]
   fn keeps_at_most_max_log_bytes() {
      let (inspector, tap, key) = inspector_with_process();
      let line = "x".repeat(MAX_LINE_BYTES);
      let fits = MAX_LOG_BYTES / MAX_LINE_BYTES;
      for _ in 0..fits + 3 {
         tap.record(TrafficDirection::Stderr, &line);
      }
      let backlog = inspector.backlog(&key).unwrap();
      assert_eq!(backlog.entries.len(), fits);
   }

   #[test]
   fn cuts_long_lines_and_keeps_their_method_and_id() {
      let (inspector, tap, key) = inspector_with_process();
      let text = "é".repeat(MAX_LINE_BYTES);
      let line = json!({
         "jsonrpc": "2.0",
         "id": 7,
         "method": "fs/write_text_file",
         "params": { "content": text },
      })
      .to_string();
      tap.record(TrafficDirection::In, &line);
      let entry = &inspector.backlog(&key).unwrap().entries[0];
      assert!(entry.truncated);
      assert!(entry.line.len() <= MAX_LINE_BYTES);
      assert_eq!(entry.original_bytes, line.len());
      assert_eq!(entry.method.as_deref(), Some("fs/write_text_file"));
      assert_eq!(entry.id, Some(json!(7)));
   }

   #[test]
   fn short_lines_are_kept_whole() {
      let (inspector, tap, key) = inspector_with_process();
      tap.record(
         TrafficDirection::Out,
         r#"{"jsonrpc":"2.0","id":1,"result":{}}"#,
      );
      let entry = &inspector.backlog(&key).unwrap().entries[0];
      assert!(!entry.truncated);
      assert_eq!(entry.method, None);
      assert_eq!(entry.line, r#"{"jsonrpc":"2.0","id":1,"result":{}}"#);
   }

   #[test]
   fn redacts_mcp_server_secrets() {
      let (inspector, tap, key) = inspector_with_process();
      let line = json!({
         "jsonrpc": "2.0",
         "id": 3,
         "method": "session/new",
         "params": {
            "cwd": "/work",
            "mcpServers": [
               {
                  "name": "local",
                  "command": "server",
                  "args": [],
                  "env": [{ "name": "TOKEN", "value": "secret-token" }],
               },
               {
                  "type": "http",
                  "name": "remote",
                  "url": "https://example.com",
                  "headers": [{ "name": "Authorization", "value": "Bearer secret" }],
               },
            ],
         },
      })
      .to_string();
      tap.record(TrafficDirection::Out, &line);
      let entry = &inspector.backlog(&key).unwrap().entries[0];
      assert!(!entry.line.contains("secret"));
      let recorded: Value = serde_json::from_str(&entry.line).unwrap();
      let servers = &recorded["params"]["mcpServers"];
      assert_eq!(servers[0]["env"][0]["name"], "TOKEN");
      assert_eq!(servers[0]["env"][0]["value"], REDACTED);
      assert_eq!(servers[1]["headers"][0]["value"], REDACTED);
      assert_eq!(servers[1]["url"], "https://example.com");
   }

   #[test]
   fn redacts_env_secrets_and_tokens_in_every_direction() {
      let (inspector, tap, key) = inspector_with_process();
      tap.record(
         TrafficDirection::Stderr,
         "starting with key env-secret-123 and Bearer abc123def456ghi",
      );
      tap.record(
         TrafficDirection::In,
         r#"{"id":1,"result":{"text":"ghp_0123456789abcdefghijABCDEFGHIJ"}}"#,
      );
      tap.record(
         TrafficDirection::Out,
         r#"{"id":2,"method":"x","params":{"note":"env-secret-123"}}"#,
      );
      let entries = inspector.backlog(&key).unwrap().entries;
      assert_eq!(
         entries[0].line,
         "starting with key [redacted] and Bearer [redacted]"
      );
      assert_eq!(
         entries[1].line,
         r#"{"id":1,"result":{"text":"[redacted]"}}"#
      );
      assert_eq!(
         entries[2].line,
         r#"{"id":2,"method":"x","params":{"note":"[redacted]"}}"#
      );
   }

   #[test]
   fn redacts_every_message_of_a_batch() {
      let message = |id: u64| {
         json!({
            "id": id,
            "method": "session/load",
            "params": { "mcpServers": [{ "env": [{ "name": "KEY", "value": "secret" }] }] },
         })
      };
      let line = json!([message(1), message(2)]).to_string();
      let redacted = redact_line(&line).unwrap();
      assert!(!redacted.contains("secret"));
   }

   #[test]
   fn the_transport_records_both_directions_and_passes_lines_through() {
      use futures::{SinkExt, executor::block_on, io::Cursor};

      let (inspector, tap, key) = inspector_with_process();
      let written = Arc::new(Mutex::new(Vec::new()));
      let (outgoing, incoming) = tapped_lines(
         SharedWriter(written.clone()),
         Cursor::new(b"{\"id\":1,\"result\":{}}\n".to_vec()),
         tap,
      );
      block_on(async {
         let mut outgoing = Box::pin(outgoing);
         outgoing
            .send(r#"{"id":1,"method":"x"}"#.to_string())
            .await
            .unwrap();
         let received: Vec<_> = incoming.collect().await;
         assert_eq!(received.len(), 1);
         assert_eq!(received[0].as_ref().unwrap(), r#"{"id":1,"result":{}}"#);
      });
      assert_eq!(&*lock(&written), b"{\"id\":1,\"method\":\"x\"}\n");
      let backlog = inspector.backlog(&key).unwrap();
      let directions: Vec<_> = backlog
         .entries
         .iter()
         .map(|entry| entry.direction)
         .collect();
      assert_eq!(directions, [TrafficDirection::Out, TrafficDirection::In]);
      assert!(!backlog.process.running);
   }

   struct SharedWriter(Arc<Mutex<Vec<u8>>>);

   impl AsyncWrite for SharedWriter {
      fn poll_write(
         self: std::pin::Pin<&mut Self>,
         _: &mut std::task::Context<'_>,
         buf: &[u8],
      ) -> std::task::Poll<io::Result<usize>> {
         lock(&self.0).extend_from_slice(buf);
         std::task::Poll::Ready(Ok(buf.len()))
      }

      fn poll_flush(
         self: std::pin::Pin<&mut Self>,
         _: &mut std::task::Context<'_>,
      ) -> std::task::Poll<io::Result<()>> {
         std::task::Poll::Ready(Ok(()))
      }

      fn poll_close(
         self: std::pin::Pin<&mut Self>,
         _: &mut std::task::Context<'_>,
      ) -> std::task::Poll<io::Result<()>> {
         std::task::Poll::Ready(Ok(()))
      }
   }

   #[test]
   fn leaves_lines_without_mcp_servers_untouched() {
      assert_eq!(
         redact_line(r#"{"method":"session/prompt","params":{"value":"x"}}"#),
         None
      );
   }

   #[test]
   fn captures_the_initialize_exchange() {
      let (inspector, tap, key) = inspector_with_process();
      tap.record(
         TrafficDirection::Out,
         r#"{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":1}}"#,
      );
      tap.record(
         TrafficDirection::In,
         r#"{"jsonrpc":"2.0","method":"session/update","params":{}}"#,
      );
      tap.record(
         TrafficDirection::In,
         r#"{"jsonrpc":"2.0","id":0,"result":{"protocolVersion":1}}"#,
      );
      inspector.clear(&key);
      let backlog = inspector.backlog(&key).unwrap();
      assert!(backlog.entries.is_empty());
      assert_eq!(
         backlog.initialize.request.unwrap()["params"]["protocolVersion"],
         1
      );
      assert_eq!(
         backlog.initialize.response.unwrap()["result"]["protocolVersion"],
         1
      );
   }

   #[test]
   fn a_new_process_starts_an_empty_log() {
      let (inspector, tap, key) = inspector_with_process();
      tap.record(TrafficDirection::Stderr, "old");
      inspector.start_process("agent", "Agent", Some(Path::new("/work")), Vec::new());
      tap.record(TrafficDirection::Stderr, "late line from the old process");
      drop(StopOnDrop(tap));
      let backlog = inspector.backlog(&key).unwrap();
      assert!(backlog.entries.is_empty());
      assert!(backlog.process.running);
   }

   #[test]
   fn marks_a_process_stopped_when_its_transport_is_dropped() {
      let (inspector, tap, _) = inspector_with_process();
      drop(StopOnDrop(tap));
      assert!(!inspector.processes()[0].running);
   }

   #[test]
   fn emits_only_while_subscribed() {
      let (inspector, tap, _) = inspector_with_process();
      let received = Arc::new(Mutex::new(Vec::new()));
      let sink = received.clone();
      inspector.set_emitter(move |event| lock(&sink).push(event));
      tap.record(TrafficDirection::Stderr, "unseen");
      inspector.subscribe();
      tap.record(TrafficDirection::Stderr, "seen");
      inspector.unsubscribe();
      inspector.unsubscribe();
      tap.record(TrafficDirection::Stderr, "unseen again");
      let received = lock(&received);
      assert_eq!(received.len(), 1);
      assert!(matches!(
         &received[0],
         TrafficEvent::Entry { entry, .. } if entry.line == "seen"
      ));
   }

   #[test]
   fn exports_parsed_messages_as_json_lines() {
      let (inspector, tap, key) = inspector_with_process();
      tap.record(
         TrafficDirection::Out,
         r#"{"jsonrpc":"2.0","id":1,"method":"x"}"#,
      );
      tap.record(TrafficDirection::Stderr, "warning");
      let export = inspector.export(&key).unwrap();
      let lines: Vec<Value> = export
         .lines()
         .map(|line| serde_json::from_str(line).unwrap())
         .collect();
      assert_eq!(lines.len(), 3);
      assert_eq!(lines[0]["process"]["agentId"], "agent");
      assert_eq!(lines[1]["message"]["method"], "x");
      assert_eq!(lines[2]["message"], "warning");
      assert_eq!(lines[2]["direction"], "stderr");
   }

   #[test]
   fn prunes_the_oldest_stopped_logs() {
      let inspector = TrafficInspector::default();
      for index in 0..MAX_LOGS + 2 {
         let tap = inspector.start_process(&format!("agent-{index}"), "Agent", None, Vec::new());
         drop(StopOnDrop(tap));
      }
      assert_eq!(inspector.processes().len(), MAX_LOGS);
   }
}
