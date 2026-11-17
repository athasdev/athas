//! One language server: its process, the threads that read and write its stdio, requests in
//! flight, and the requests it makes of us. Messages sent before `initialize` returns wait in a
//! queue so documents can open while the server starts. A server elsewhere (the web workbench's
//! workspace server) is reached with [`LanguageServer::connect_messages`] instead: whole messages
//! go out through a function and come back through [`LanguageServer::receive`], with no threads.
//!
//! The transport design follows Zed's `lsp` crate (GPL-3.0), adapted for Athas: plain threads
//! instead of an async runtime, so it runs beside GPUI without one.

use std::{
    collections::{HashMap, VecDeque},
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        Arc, OnceLock,
        atomic::{AtomicBool, AtomicI64, Ordering},
        mpsc,
    },
    time::Duration,
};

use anyhow::{Context as _, Result, anyhow};
use futures::channel::{mpsc::UnboundedSender, oneshot};
use lsp_types::{
    InitializeResult, ServerCapabilities, TextDocumentContentChangeEvent, TextDocumentSyncCapability, TextDocumentSyncKind, Url,
    notification::Notification, request::Request,
};
use parking_lot::Mutex;
use ropey::Rope;
use serde_json::{Value, json};

use crate::{
    registry::Launch,
    rpc::{self, Incoming, RpcError},
    text::TextChange,
};

pub type ServerId = usize;

/// What a server tells the client, delivered on the foreground by the store.
#[derive(Debug)]
pub enum ServerMessage {
    /// `initialize` finished; the capabilities are known.
    Ready,
    Notification { method: String, params: Value },
    /// `workspace/applyEdit`: the reply says whether the edit was applied.
    ApplyEdit { edit: lsp_types::WorkspaceEdit, reply: oneshot::Sender<bool> },
    /// `workspace/*/refresh`: the server's inlay hints, code lenses, … changed.
    Refresh(String),
    /// The process ended, or `initialize` failed.
    Exited { error: Option<String> },
}

#[derive(Debug)]
pub struct ServerEvent {
    pub server: ServerId,
    pub message: ServerMessage,
}

pub type EventSink = UnboundedSender<ServerEvent>;

enum Outgoing {
    Text(String),
    /// Serialized when sent, once the server's sync kind is known.
    Change { uri: Url, version: i32, changes: Vec<TextChange>, text: Rope },
}

#[derive(Default)]
struct Gate {
    ready: bool,
    failed: Option<String>,
    queue: Vec<Outgoing>,
}

type Pending = Mutex<HashMap<i64, oneshot::Sender<Result<Value, RpcError>>>>;

/// Sends one message, unframed, to the server.
pub type MessageWriter = Box<dyn Fn(String) + Send + Sync>;

struct Shared {
    id: ServerId,
    name: String,
    root: PathBuf,
    /// Answers `workspace/configuration`: the manifest's initialization options.
    settings: Value,
    next_id: AtomicI64,
    init_id: i64,
    pending: Pending,
    gate: Mutex<Gate>,
    writer: Mutex<Option<MessageWriter>>,
    capabilities: OnceLock<ServerCapabilities>,
    running: AtomicBool,
    stderr_tail: Mutex<VecDeque<String>>,
    events: EventSink,
}

pub struct LanguageServer {
    shared: Arc<Shared>,
    child: Mutex<Option<Child>>,
}

/// How long a stopping server gets to exit after `shutdown` before it is killed.
const SHUTDOWN_GRACE: Duration = Duration::from_secs(2);
const STDERR_LINES: usize = 40;

impl LanguageServer {
    /// Starts the server process and sends `initialize`.
    pub fn spawn(id: ServerId, name: &str, launch: &Launch, root: &Path, options: Option<Value>, events: EventSink) -> Result<Arc<Self>> {
        let mut command = Command::new(&launch.program);
        command.args(&launch.args).envs(launch.env.iter().map(|(key, value)| (key, value))).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        if root.is_dir() {
            command.current_dir(root);
        }
        let mut child = command.spawn().with_context(|| format!("starting {}", launch.program.display()))?;
        let stdin = child.stdin.take().context("no stdin")?;
        let stdout = child.stdout.take().context("no stdout")?;
        let stderr = child.stderr.take();
        let server = Self::connect(id, name, root, options, events, stdin, stdout, stderr)?;
        *server.child.lock() = Some(child);
        Ok(server)
    }

    /// Talks to a server over any pair of streams (a process's stdio, or a test's pipes).
    #[allow(clippy::too_many_arguments)]
    pub fn connect(
        id: ServerId,
        name: &str,
        root: &Path,
        options: Option<Value>,
        events: EventSink,
        stdin: impl Write + Send + 'static,
        stdout: impl Read + Send + 'static,
        stderr: Option<impl Read + Send + 'static>,
    ) -> Result<Arc<Self>> {
        let (writer_tx, writer_rx) = mpsc::channel::<String>();
        let shared = Shared::new(id, name, root, options.clone(), events, Box::new(move |body| {
            writer_tx.send(body).ok();
        }));
        std::thread::Builder::new().name(format!("lsp-{name}-write")).spawn(move || {
            let mut stdin = stdin;
            while let Ok(body) = writer_rx.recv() {
                if rpc::write_message(&mut stdin, &body).is_err() {
                    break;
                }
            }
        })?;
        let reader_shared = shared.clone();
        std::thread::Builder::new().name(format!("lsp-{name}-read")).spawn(move || read_loop(reader_shared, stdout))?;
        if let Some(stderr) = stderr {
            let stderr_shared = shared.clone();
            std::thread::Builder::new().name(format!("lsp-{name}-stderr")).spawn(move || {
                for line in BufReader::new(stderr).lines() {
                    let Ok(line) = line else { break };
                    let mut tail = stderr_shared.stderr_tail.lock();
                    if tail.len() == STDERR_LINES {
                        tail.pop_front();
                    }
                    tail.push_back(line);
                }
            })?;
        }
        shared.initialize(root, options);
        Ok(Arc::new(Self { shared, child: Mutex::new(None) }))
    }

    /// Talks to a server that `write` sends whole messages to; what it answers is handed to
    /// [`Self::receive`], and its end to [`Self::disconnected`].
    pub fn connect_messages(id: ServerId, name: &str, root: &Path, options: Option<Value>, events: EventSink, write: MessageWriter) -> Arc<Self> {
        let shared = Shared::new(id, name, root, options.clone(), events, write);
        shared.initialize(root, options);
        Arc::new(Self { shared, child: Mutex::new(None) })
    }

    /// One message the server sent, without its framing.
    pub fn receive(&self, body: &str) {
        dispatch(&self.shared, body);
    }

    /// The connection to the server ended; `error` says why when it was not asked to.
    pub fn disconnected(&self, error: Option<String>) {
        finish(&self.shared, error);
    }

    pub fn id(&self) -> ServerId {
        self.shared.id
    }

    pub fn name(&self) -> &str {
        &self.shared.name
    }

    pub fn root(&self) -> &Path {
        &self.shared.root
    }

    /// The server's capabilities, once `initialize` returned.
    pub fn capabilities(&self) -> Option<&ServerCapabilities> {
        self.shared.capabilities.get()
    }

    pub fn is_running(&self) -> bool {
        self.shared.running.load(Ordering::SeqCst) && self.shared.gate.lock().failed.is_none()
    }

    /// The last lines the server wrote to stderr, for error messages.
    pub fn stderr_tail(&self) -> String {
        self.shared.stderr_tail.lock().iter().cloned().collect::<Vec<_>>().join("\n")
    }

    /// Sends a request; the future resolves with the server's answer. Dropping it early cancels
    /// the request (`$/cancelRequest`).
    pub fn request<R: Request>(&self, params: R::Params) -> impl Future<Output = Result<R::Result>> + use<R> {
        let shared = self.shared.clone();
        let id = shared.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        let sent = serde_json::to_value(params).map_err(anyhow::Error::from).and_then(|params| {
            shared.pending.lock().insert(id, tx);
            shared.send(Outgoing::Text(rpc::request(id, R::METHOD, &params)))
        });
        let guard = CancelOnDrop { shared: shared.clone(), id, armed: sent.is_ok() };
        async move {
            let mut guard = guard;
            sent?;
            let answer = rx.await;
            guard.armed = false;
            let value = answer.map_err(|_| anyhow!("{} stopped", shared.name))??;
            Ok(serde_json::from_value(value)?)
        }
    }

    pub fn notify<N: Notification>(&self, params: N::Params) {
        if let Ok(params) = serde_json::to_value(params) {
            self.shared.send(Outgoing::Text(rpc::notification(N::METHOD, &params))).ok();
        }
    }

    /// `textDocument/didChange`, incremental or full as the server asked.
    pub fn did_change(&self, uri: Url, version: i32, changes: Vec<TextChange>, text: Rope) {
        self.shared.send(Outgoing::Change { uri, version, changes, text }).ok();
    }

    /// Asks the server to exit, and kills it if it does not.
    pub fn shutdown(&self) {
        if !self.shared.running.swap(false, Ordering::SeqCst) {
            return;
        }
        let id = self.shared.next_id.fetch_add(1, Ordering::SeqCst);
        self.shared.write(rpc::request(id, "shutdown", &Value::Null));
        self.shared.write(rpc::notification("exit", &Value::Null));
        self.shared.writer.lock().take();
        if let Some(mut child) = self.child.lock().take() {
            std::thread::Builder::new()
                .name("lsp-shutdown".into())
                .spawn(move || {
                    let deadline = std::time::Instant::now() + SHUTDOWN_GRACE;
                    while std::time::Instant::now() < deadline {
                        if matches!(child.try_wait(), Ok(Some(_))) {
                            return;
                        }
                        std::thread::sleep(Duration::from_millis(50));
                    }
                    child.kill().ok();
                    child.wait().ok();
                })
                .ok();
        }
    }
}

impl Drop for LanguageServer {
    fn drop(&mut self) {
        self.shutdown();
    }
}

struct CancelOnDrop {
    shared: Arc<Shared>,
    id: i64,
    armed: bool,
}

impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        if self.armed && self.shared.pending.lock().remove(&self.id).is_some() {
            self.shared.send(Outgoing::Text(rpc::notification("$/cancelRequest", &json!({ "id": self.id })))).ok();
        }
    }
}

impl Shared {
    fn new(id: ServerId, name: &str, root: &Path, options: Option<Value>, events: EventSink, writer: MessageWriter) -> Arc<Self> {
        Arc::new(Self {
            id,
            name: name.to_string(),
            root: root.to_path_buf(),
            settings: options.unwrap_or(Value::Null),
            next_id: AtomicI64::new(1),
            init_id: 0,
            pending: Mutex::default(),
            gate: Mutex::default(),
            writer: Mutex::new(Some(writer)),
            capabilities: OnceLock::new(),
            running: AtomicBool::new(true),
            stderr_tail: Mutex::default(),
            events,
        })
    }

    fn initialize(&self, root: &Path, options: Option<Value>) {
        self.write(rpc::request(self.init_id, "initialize", &initialize_params(root, options)));
    }

    /// Writes past the queue (initialize, responses, shutdown).
    fn write(&self, body: String) {
        if let Some(writer) = self.writer.lock().as_ref() {
            writer(body);
        }
    }

    fn send(&self, outgoing: Outgoing) -> Result<()> {
        let mut gate = self.gate.lock();
        if let Some(error) = &gate.failed {
            return Err(anyhow!("{} is not running: {error}", self.name));
        }
        if !self.running.load(Ordering::SeqCst) {
            return Err(anyhow!("{} stopped", self.name));
        }
        if gate.ready {
            if let Some(body) = self.serialize(outgoing) {
                self.write(body);
            }
        } else {
            gate.queue.push(outgoing);
        }
        Ok(())
    }

    fn serialize(&self, outgoing: Outgoing) -> Option<String> {
        match outgoing {
            Outgoing::Text(body) => Some(body),
            Outgoing::Change { uri, version, changes, text } => {
                let kind = match self.capabilities.get().and_then(|capabilities| capabilities.text_document_sync.as_ref()) {
                    Some(TextDocumentSyncCapability::Kind(kind)) => *kind,
                    Some(TextDocumentSyncCapability::Options(options)) => options.change.unwrap_or(TextDocumentSyncKind::NONE),
                    None => TextDocumentSyncKind::FULL,
                };
                let content_changes: Vec<TextDocumentContentChangeEvent> = if kind == TextDocumentSyncKind::NONE {
                    return None;
                } else if kind == TextDocumentSyncKind::INCREMENTAL {
                    changes
                        .into_iter()
                        .map(|change| TextDocumentContentChangeEvent { range: Some(change.range), range_length: None, text: change.text })
                        .collect()
                } else {
                    vec![TextDocumentContentChangeEvent { range: None, range_length: None, text: text.to_string() }]
                };
                let params = json!({ "textDocument": { "uri": uri, "version": version }, "contentChanges": content_changes });
                Some(rpc::notification("textDocument/didChange", &params))
            }
        }
    }

    fn finish_initialize(&self, result: Result<Value, RpcError>) {
        let parsed = result.map_err(|error| error.to_string()).and_then(|value| serde_json::from_value::<InitializeResult>(value).map_err(|error| error.to_string()));
        match parsed {
            Ok(result) => {
                self.capabilities.set(result.capabilities).ok();
                self.write(rpc::notification("initialized", &json!({})));
                let mut gate = self.gate.lock();
                gate.ready = true;
                for outgoing in std::mem::take(&mut gate.queue) {
                    if let Some(body) = self.serialize(outgoing) {
                        self.write(body);
                    }
                }
                drop(gate);
                self.emit(ServerMessage::Ready);
            }
            Err(error) => {
                let mut gate = self.gate.lock();
                gate.failed = Some(error.clone());
                gate.queue.clear();
                drop(gate);
                self.pending.lock().clear();
                self.emit(ServerMessage::Exited { error: Some(format!("{} failed to start: {error}", self.name)) });
            }
        }
    }

    fn emit(&self, message: ServerMessage) {
        self.events.unbounded_send(ServerEvent { server: self.id, message }).ok();
    }

    /// Answers a request the server makes of the client.
    fn handle_request(self: &Arc<Self>, id: Value, method: &str, params: Value) {
        let result = match method {
            "workspace/configuration" => {
                let items = params.get("items").and_then(Value::as_array).cloned().unwrap_or_default();
                Ok(Value::Array(
                    items
                        .iter()
                        .map(|item| match item.get("section").and_then(Value::as_str) {
                            Some(section) => configuration_value(&self.settings, section),
                            None => self.settings.clone(),
                        })
                        .collect(),
                ))
            }
            "workspace/workspaceFolders" => Ok(json!([workspace_folder(&self.root)])),
            "window/workDoneProgress/create" | "client/registerCapability" | "client/unregisterCapability" => Ok(Value::Null),
            "window/showMessageRequest" | "window/showDocument" => {
                self.emit(ServerMessage::Notification { method: "window/showMessage".into(), params: params.clone() });
                Ok(if method == "window/showDocument" { json!({ "success": false }) } else { Value::Null })
            }
            method if method.starts_with("workspace/") && method.ends_with("/refresh") => {
                self.emit(ServerMessage::Refresh(method.to_string()));
                Ok(Value::Null)
            }
            "workspace/applyEdit" => {
                let edit = params.get("edit").cloned().and_then(|edit| serde_json::from_value(edit).ok());
                if let Some(edit) = edit {
                    let (reply, answer) = oneshot::channel();
                    self.emit(ServerMessage::ApplyEdit { edit, reply });
                    let shared = self.clone();
                    let reply = async move {
                        let applied = answer.await.unwrap_or(false);
                        shared.write(rpc::response(&id, Ok(json!({ "applied": applied }))));
                    };
                    // The foreground applies it; the answer goes back from elsewhere so reading
                    // continues meanwhile.
                    #[cfg(not(target_family = "wasm"))]
                    std::thread::Builder::new().name("lsp-apply-edit".into()).spawn(move || futures::executor::block_on(reply)).ok();
                    #[cfg(target_family = "wasm")]
                    wasm_bindgen_futures::spawn_local(reply);
                    return;
                }
                Ok(json!({ "applied": false }))
            }
            _ => Err(RpcError { code: rpc::METHOD_NOT_FOUND, message: format!("{method} is not supported"), data: None }),
        };
        self.write(rpc::response(&id, result));
    }
}

fn read_loop(shared: Arc<Shared>, stdout: impl Read) {
    let mut reader = BufReader::new(stdout);
    while let Ok(Some(body)) = rpc::read_message(&mut reader) {
        dispatch(&shared, &body);
    }
    let tail = shared.stderr_tail.lock().iter().rev().take(5).cloned().collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n");
    finish(&shared, (!tail.is_empty()).then_some(tail));
}

fn dispatch(shared: &Arc<Shared>, body: &str) {
    let Ok(message) = rpc::parse(body) else { return };
    match message {
        Incoming::Response { id, result } if id == shared.init_id && shared.capabilities.get().is_none() => shared.finish_initialize(result),
        Incoming::Response { id, result } => {
            if let Some(sender) = shared.pending.lock().remove(&id) {
                sender.send(result).ok();
            }
        }
        Incoming::Request { id, method, params } => shared.handle_request(id, &method, params),
        Incoming::Notification { method, params } => shared.emit(ServerMessage::Notification { method, params }),
    }
}

/// The server is gone: requests in flight fail, and an exit nobody asked for is reported with
/// `detail` (the end of its stderr).
fn finish(shared: &Shared, detail: Option<String>) {
    let expected = !shared.running.swap(false, Ordering::SeqCst);
    shared.pending.lock().clear();
    shared.writer.lock().take();
    let error = (!expected).then(|| match detail {
        Some(detail) => format!("{} exited: {detail}", shared.name),
        None => format!("{} exited", shared.name),
    });
    shared.emit(ServerMessage::Exited { error });
}

/// The value at a dotted `section` of the settings (`rust-analyzer.cargo` → `settings.cargo`
/// when the settings are the server's own, or `settings["rust-analyzer"]["cargo"]`).
fn configuration_value(settings: &Value, section: &str) -> Value {
    let walk = |keys: &[&str]| keys.iter().try_fold(settings, |current, key| current.get(key)).cloned();
    let keys: Vec<&str> = section.split('.').collect();
    walk(&keys).or_else(|| if keys.len() > 1 { walk(&keys[1..]) } else { None }).unwrap_or(Value::Null)
}

fn workspace_folder(root: &Path) -> Value {
    let uri = crate::uri::from_directory(root).map(|url| url.to_string()).unwrap_or_default();
    let name = root.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
    json!({ "uri": uri, "name": name })
}

#[cfg(not(target_family = "wasm"))]
fn process_id() -> Option<u32> {
    Some(std::process::id())
}

/// The browser has no process the server could watch.
#[cfg(target_family = "wasm")]
fn process_id() -> Option<u32> {
    None
}

/// What the client supports: the features the editor draws, with snippets, markdown and
/// hierarchical symbols.
fn initialize_params(root: &Path, options: Option<Value>) -> Value {
    let root_uri = crate::uri::from_directory(root);
    json!({
        "processId": process_id(),
        "clientInfo": { "name": "Athas", "version": env!("CARGO_PKG_VERSION") },
        "rootUri": root_uri,
        "rootPath": root,
        "workspaceFolders": [workspace_folder(root)],
        "initializationOptions": options,
        "capabilities": {
            "general": { "positionEncodings": ["utf-16"] },
            "window": { "workDoneProgress": true, "showMessage": {}, "showDocument": { "support": false } },
            "workspace": {
                "applyEdit": true,
                "configuration": true,
                "workspaceFolders": true,
                "workspaceEdit": { "documentChanges": true, "resourceOperations": ["create", "rename", "delete"] },
                "didChangeConfiguration": { "dynamicRegistration": false },
                "symbol": {},
                "executeCommand": {},
                "inlayHint": { "refreshSupport": true },
                "codeLens": { "refreshSupport": false },
                "semanticTokens": { "refreshSupport": false },
                "diagnostics": { "refreshSupport": false }
            },
            "textDocument": {
                "synchronization": { "didSave": true, "willSave": false, "willSaveWaitUntil": false, "dynamicRegistration": false },
                "completion": {
                    "completionItem": {
                        "snippetSupport": true,
                        "documentationFormat": ["markdown", "plaintext"],
                        "deprecatedSupport": true,
                        "labelDetailsSupport": true,
                        "insertReplaceSupport": false,
                        "resolveSupport": { "properties": ["documentation", "detail", "additionalTextEdits"] }
                    },
                    "completionItemKind": { "valueSet": (1..=25).collect::<Vec<u32>>() },
                    "contextSupport": true
                },
                "hover": { "contentFormat": ["markdown", "plaintext"] },
                "signatureHelp": {
                    "signatureInformation": {
                        "documentationFormat": ["markdown", "plaintext"],
                        "parameterInformation": { "labelOffsetSupport": true },
                        "activeParameterSupport": true
                    },
                    "contextSupport": true
                },
                "definition": { "linkSupport": true },
                "typeDefinition": { "linkSupport": true },
                "implementation": { "linkSupport": true },
                "references": {},
                "documentHighlight": {},
                "documentSymbol": { "hierarchicalDocumentSymbolSupport": true, "symbolKind": { "valueSet": (1..=26).collect::<Vec<u32>>() } },
                "codeAction": {
                    "codeActionLiteralSupport": {
                        "codeActionKind": { "valueSet": ["", "quickfix", "refactor", "refactor.extract", "refactor.inline", "refactor.rewrite", "source", "source.organizeImports", "source.fixAll"] }
                    },
                    "dataSupport": true,
                    "isPreferredSupport": true,
                    "resolveSupport": { "properties": ["edit"] }
                },
                "formatting": {},
                "rangeFormatting": {},
                "onTypeFormatting": {},
                "selectionRange": {},
                "rename": { "prepareSupport": true },
                "publishDiagnostics": { "relatedInformation": true, "versionSupport": true, "codeDescriptionSupport": true },
                "inlayHint": { "resolveSupport": { "properties": [] } },
                "codeLens": {},
                "semanticTokens": {
                    "requests": { "full": { "delta": true }, "range": false },
                    "tokenTypes": ["namespace", "type", "class", "enum", "interface", "struct", "typeParameter", "parameter", "variable", "property", "enumMember", "event", "function", "method", "macro", "keyword", "modifier", "comment", "string", "number", "regexp", "operator", "decorator"],
                    "tokenModifiers": ["declaration", "definition", "readonly", "static", "deprecated", "abstract", "async", "modification", "documentation", "defaultLibrary"],
                    "formats": ["relative"],
                    "overlappingTokenSupport": false,
                    "multilineTokenSupport": false
                }
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn configuration_sections() {
        let settings = json!({ "cargo": { "features": "all" }, "python": { "analysis": { "mode": 1 } } });
        assert_eq!(configuration_value(&settings, "cargo"), json!({ "features": "all" }));
        assert_eq!(configuration_value(&settings, "python.analysis.mode"), json!(1));
        assert_eq!(configuration_value(&settings, "rust-analyzer.cargo.features"), json!("all"));
        assert_eq!(configuration_value(&settings, "missing"), Value::Null);
    }
}
