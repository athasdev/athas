//! The client side of the Agent Client Protocol: starts and drives one agent session, and answers
//! what the agent asks of the client (permissions, files, terminals).
//!
//! Adapted from Athas's `crates/ai/src/acp/{client,bridge_init}.rs`.

use std::{
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicI64, Ordering},
    },
};

use agent_client_protocol_schema::{ProtocolVersion, v1 as acp};
use futures::{
    FutureExt as _, StreamExt,
    channel::{mpsc, oneshot},
    future::BoxFuture,
    stream::FuturesUnordered,
};
use serde_json::{Value, json};

use super::{
    host::ClientHost,
    rpc::{Incoming, RpcConnection, RpcError, Transport},
};

/// What the client hears from the agent, for the session's view.
pub enum ClientEvent {
    Update(acp::SessionUpdate),
    Permission(PermissionRequest),
    /// The agent wrote this file through the client: what it held before (`None` when it did
    /// not exist) and now.
    FileWritten { path: PathBuf, previous: Option<String>, content: String },
    /// A terminal the agent runs printed something or finished.
    TerminalChanged(String),
    /// The agent asks the user a structured question or to open a link (`elicitation/create`).
    Elicitation(ElicitationRequest),
    /// The flow behind an accepted URL elicitation finished (`elicitation/complete`).
    ElicitationComplete(String),
    /// The agent asks for a terminal tab, running `command` when given (`_athas/open_terminal`).
    OpenTerminal(Option<String>),
    /// The agent names the chat (`_athas/set_chat_title`).
    SetTitle(String),
    /// The agent reads `path`: what an open editor holds for it, unsaved edits included, or
    /// `None` (or dropping it) to read the disk (`acp-buffer-read`).
    BufferRead { path: PathBuf, respond: oneshot::Sender<Option<String>> },
}

/// An `elicitation/create` request as the agent sent it, and where its answer goes.
pub struct ElicitationRequest {
    pub request: Value,
    /// The JSON-RPC result (`{ action, content? }`); dropping it cancels.
    pub respond: oneshot::Sender<Value>,
}

/// The agent asks the user to choose one of `options` before it goes on.
pub struct PermissionRequest {
    pub tool_call: acp::ToolCallUpdate,
    pub options: Vec<acp::PermissionOption>,
    /// The chosen option; `None` (or dropping it) cancels.
    pub respond: oneshot::Sender<Option<acp::PermissionOptionId>>,
}

/// A connection to one agent process.
pub struct AgentConnection {
    rpc: Arc<RpcConnection>,
    host: Option<Arc<dyn ClientHost>>,
    /// While a `session/load` replays history the view already has, its updates are dropped.
    suppress_replay_until: AtomicI64,
    /// The session whose history is being dropped, so other sessions on the connection keep theirs.
    replay_session: Mutex<Option<String>>,
    events: mpsc::UnboundedSender<ClientEvent>,
    /// Sessions sharing the connection get their own events (`route_session`); until one is routed,
    /// everything goes to `events`.
    routes: Mutex<Routes>,
    closed: AtomicBool,
    agent_info: Mutex<Option<acp::InitializeResponse>>,
    /// The `sessionCapabilities` the agent advertised by name, including ones this schema does
    /// not type, such as `close`.
    session_capability_names: Mutex<Vec<String>>,
    /// The sign-in method the user picked, tried when the agent asks for sign-in.
    preferred_auth: Mutex<Option<String>>,
    additional_directories: Mutex<Vec<PathBuf>>,
    /// The view answers file reads from open editors (`read_open_buffers`).
    open_buffer_reads: AtomicBool,
    /// Folders outside the project the user let each session read for the rest of the session.
    outside_read_grants: Mutex<std::collections::HashMap<String, std::collections::HashSet<PathBuf>>>,
}

/// What an agent wants to do with a file outside the project (`file_access.rs`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FileAccess {
    Read,
    Write,
}

const ALLOW_ONCE: &str = "allow_once";
const ALLOW_FOLDER: &str = "allow_folder_for_session";
const DENY: &str = "deny";

/// The choices an outside-the-project prompt offers (`outside_access_options`): only reads can
/// be allowed for the session's folder; each write outside is asked about on its own.
fn outside_access_options(access: FileAccess) -> Vec<acp::PermissionOption> {
    let mut options = vec![acp::PermissionOption::new(ALLOW_ONCE, "Allow once", acp::PermissionOptionKind::AllowOnce)];
    if access == FileAccess::Read {
        options.push(acp::PermissionOption::new(ALLOW_FOLDER, "Allow reads in this folder for this session", acp::PermissionOptionKind::AllowAlways));
    }
    options.push(acp::PermissionOption::new(DENY, "Deny", acp::PermissionOptionKind::RejectOnce));
    options
}

/// What the prompt shows (`outside_access_tool_call`): the path, why it asks, and for a write the
/// change as a diff (`old_text` is `None` for a new file).
fn outside_access_tool_call(access: FileAccess, path: &Path, old_text: Option<String>, new_text: Option<&str>) -> acp::ToolCallUpdate {
    let shown = path.display();
    let (id, title, kind, reason) = match access {
        FileAccess::Read => (
            format!("read-outside:{shown}"),
            format!("Read {shown}"),
            acp::ToolKind::Read,
            "The agent wants to read a file outside the workspace. Always lets it read other files in the same folder for the rest of this session.",
        ),
        FileAccess::Write => (format!("write-outside:{shown}"), format!("Write {shown}"), acp::ToolKind::Edit, "The agent wants to write a file outside the workspace."),
    };
    let mut content = vec![acp::ToolCallContent::from(reason)];
    if let Some(new_text) = new_text {
        content.push(acp::Diff::new(path.to_path_buf(), new_text.to_string()).old_text(old_text).into());
    }
    let fields = acp::ToolCallUpdateFields::new()
        .title(title)
        .kind(kind)
        .status(acp::ToolCallStatus::Pending)
        .content(content)
        .locations(vec![acp::ToolCallLocation::new(path.to_path_buf())]);
    acp::ToolCallUpdate::new(id, fields)
}

/// The error for an access the user did not allow (`access_denied`).
fn access_denied(path: &Path) -> RpcError {
    RpcError::internal(format!("The user did not allow access to {}, which is outside the workspace", path.display()))
}

/// Where a shared connection's events go: each session's own channel, and the events of a
/// session not routed yet, kept until it is.
#[derive(Default)]
struct Routes {
    shared: bool,
    sessions: std::collections::HashMap<String, mpsc::UnboundedSender<ClientEvent>>,
    pending: Vec<(String, ClientEvent)>,
}

/// Unroutes its session when dropped.
pub struct SessionRoute {
    connection: Arc<AgentConnection>,
    session_id: String,
}

impl Drop for SessionRoute {
    fn drop(&mut self) {
        let mut routes = self.connection.routes.lock().unwrap_or_else(|p| p.into_inner());
        routes.sessions.remove(&self.session_id);
        routes.pending.retain(|(session, _)| *session != self.session_id);
    }
}

/// The workspace roots besides `cwd` a session should also cover (`acp-additional-directories.ts`,
/// `workspace_path.rs`): local folders only, without trailing separators, the primary and
/// repeats left out.
pub fn additional_directories(cwd: &Path, roots: &[PathBuf]) -> Vec<PathBuf> {
    let trim = |path: &Path| PathBuf::from(path.to_string_lossy().trim_end_matches(['/', '\\']));
    let primary = trim(cwd);
    let mut directories: Vec<PathBuf> = Vec::new();
    for root in roots {
        let directory = trim(root);
        if directory.as_os_str().is_empty() || !directory.is_absolute() || directory.to_string_lossy().contains("://") {
            continue;
        }
        if directory == primary || directories.contains(&directory) {
            continue;
        }
        directories.push(directory);
    }
    directories
}

/// How long a file read waits for the editor's text before reading the disk (`BUFFER_READ_TIMEOUT`).
const BUFFER_READ_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);

/// Resolves after `after`, from one shared timer thread, so a read's wait needs no executor.
#[cfg(not(target_family = "wasm"))]
fn deadline(after: std::time::Duration) -> futures::future::BoxFuture<'static, ()> {
    use std::{
        cmp::Reverse,
        collections::BinaryHeap,
        sync::{OnceLock, mpsc as std_mpsc},
        time::Instant,
    };
    use std::collections::HashMap;
    type Waiter = (Instant, u64, oneshot::Sender<()>);
    static TIMER: OnceLock<Mutex<std_mpsc::Sender<Waiter>>> = OnceLock::new();
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let sender = TIMER.get_or_init(|| {
        let (tx, rx) = std_mpsc::channel::<Waiter>();
        std::thread::Builder::new()
            .name("acp-read-timer".into())
            .spawn(move || {
                let mut heap: BinaryHeap<Reverse<(Instant, u64)>> = BinaryHeap::new();
                let mut waiting: HashMap<u64, oneshot::Sender<()>> = HashMap::new();
                loop {
                    let next = heap.peek().map(|Reverse((at, _))| *at);
                    let received = match next {
                        Some(at) => rx.recv_timeout(at.saturating_duration_since(Instant::now())),
                        None => rx.recv().map_err(|_| std_mpsc::RecvTimeoutError::Disconnected),
                    };
                    match received {
                        Ok((at, id, done)) => {
                            heap.push(Reverse((at, id)));
                            waiting.insert(id, done);
                        }
                        Err(std_mpsc::RecvTimeoutError::Disconnected) => return,
                        Err(std_mpsc::RecvTimeoutError::Timeout) => {}
                    }
                    let now = Instant::now();
                    while heap.peek().is_some_and(|Reverse((at, _))| *at <= now) {
                        if let Some(Reverse((_, id))) = heap.pop()
                            && let Some(done) = waiting.remove(&id)
                        {
                            done.send(()).ok();
                        }
                    }
                }
            })
            .ok();
        Mutex::new(tx)
    });
    let (done, fired) = oneshot::channel();
    let id = NEXT.fetch_add(1, Ordering::Relaxed);
    sender.lock().unwrap_or_else(|p| p.into_inner()).send((Instant::now() + after, id, done)).ok();
    async move {
        fired.await.ok();
    }
    .boxed()
}

#[cfg(target_family = "wasm")]
fn deadline(_after: std::time::Duration) -> futures::future::BoxFuture<'static, ()> {
    futures::future::pending().boxed()
}

const NO_REPLAY: i64 = -1;
const REPLAY_STARTING: i64 = i64::MAX;

impl AgentConnection {
    /// Connects over `transport`. `host` answers file and terminal requests; without one the
    /// client does not offer them. The returned future runs the connection and must be polled
    /// (on a background executor); it ends when the agent goes away.
    pub fn new(
        transport: Transport,
        host: Option<Arc<dyn ClientHost>>,
    ) -> (Arc<Self>, mpsc::UnboundedReceiver<ClientEvent>, BoxFuture<'static, ()>) {
        let (rpc, incoming, reader) = RpcConnection::new(transport);
        let (events_tx, events_rx) = mpsc::unbounded();
        let connection = Arc::new(Self {
            rpc,
            host,
            suppress_replay_until: AtomicI64::new(NO_REPLAY),
            replay_session: Mutex::new(None),
            events: events_tx,
            routes: Mutex::new(Routes::default()),
            closed: AtomicBool::new(false),
            agent_info: Mutex::new(None),
            session_capability_names: Mutex::new(Vec::new()),
            preferred_auth: Mutex::new(None),
            additional_directories: Mutex::new(Vec::new()),
            open_buffer_reads: AtomicBool::new(false),
            outside_read_grants: Mutex::default(),
        });
        let dispatch = connection.clone().dispatch(incoming);
        let io = async move {
            futures::future::join(reader, dispatch).await;
        }
        .boxed();
        (connection, events_rx, io)
    }

    /// Shares the connection between sessions: from now on each session's events go to the
    /// channel `route_session` gives it, and events of sessions not routed yet wait for it.
    pub fn share(&self) {
        self.routes.lock().unwrap_or_else(|p| p.into_inner()).shared = true;
    }

    /// The events of `session_id` on a shared connection, those that came before included.
    pub fn route_session(self: &Arc<Self>, session_id: &str) -> (mpsc::UnboundedReceiver<ClientEvent>, SessionRoute) {
        let (sender, receiver) = mpsc::unbounded();
        let mut routes = self.routes.lock().unwrap_or_else(|p| p.into_inner());
        let pending = std::mem::take(&mut routes.pending);
        for (session, event) in pending {
            if session == session_id {
                let _ = sender.unbounded_send(event);
            } else {
                routes.pending.push((session, event));
            }
        }
        if self.is_closed() {
            sender.close_channel();
        }
        routes.sessions.insert(session_id.to_string(), sender);
        (receiver, SessionRoute { connection: self.clone(), session_id: session_id.to_string() })
    }

    /// Sends `event` to its session's channel on a shared connection, else to the connection's.
    /// Events without a session go to every session.
    fn send_event(&self, session: Option<&str>, event: ClientEvent) -> bool {
        let mut routes = self.routes.lock().unwrap_or_else(|p| p.into_inner());
        if !routes.shared {
            drop(routes);
            return self.events.unbounded_send(event).is_ok();
        }
        match session {
            Some(session) => match routes.sessions.get(session) {
                Some(sender) => sender.unbounded_send(event).is_ok(),
                None => {
                    routes.pending.push((session.to_string(), event));
                    true
                }
            },
            None => match event {
                // Without a session id the title could land on another chat.
                ClientEvent::SetTitle(_) => false,
                ClientEvent::ElicitationComplete(id) => {
                    for sender in routes.sessions.values() {
                        let _ = sender.unbounded_send(ClientEvent::ElicitationComplete(id.clone()));
                    }
                    true
                }
                other => routes.sessions.values().next().is_some_and(|sender| sender.unbounded_send(other).is_ok()),
            },
        }
    }

    pub fn is_closed(&self) -> bool {
        self.closed.load(Ordering::Relaxed)
    }

    /// Whether the agent can be stopped to save its process (`is_idle`): nothing went either way
    /// for `timeout`, no request waits for an answer, and it can load its sessions again.
    pub fn is_idle(&self, timeout: std::time::Duration) -> bool {
        !self.rpc.has_pending() && self.agent_capabilities().is_some_and(|capabilities| capabilities.load_session) && self.rpc.idle_for() >= timeout
    }

    pub fn agent_capabilities(&self) -> Option<acp::AgentCapabilities> {
        self.agent_info.lock().unwrap_or_else(|p| p.into_inner()).as_ref().map(|info| info.agent_capabilities.clone())
    }

    /// Initializes the connection once; a shared connection answers later calls from the first.
    pub async fn initialize(&self) -> Result<acp::InitializeResponse, RpcError> {
        if let Some(info) = self.agent_info.lock().unwrap_or_else(|p| p.into_inner()).clone() {
            return Ok(info);
        }
        let request = acp::InitializeRequest::new(ProtocolVersion::V1)
            .client_capabilities(self.client_capabilities())
            .client_info(acp::Implementation::new("athas", env!("CARGO_PKG_VERSION")).title("Athas"));
        let raw = self.rpc.request_value("initialize", serde_json::to_value(request).map_err(RpcError::invalid_params)?).await?;
        let names = raw
            .pointer("/agentCapabilities/sessionCapabilities")
            .and_then(Value::as_object)
            .map(|capabilities| capabilities.iter().filter(|(_, value)| !value.is_null()).map(|(name, _)| name.clone()).collect())
            .unwrap_or_default();
        *self.session_capability_names.lock().unwrap_or_else(|p| p.into_inner()) = names;
        let response: acp::InitializeResponse = serde_json::from_value(raw).map_err(|error| RpcError::internal(format!("Unexpected answer to initialize: {error}")))?;
        if response.protocol_version != ProtocolVersion::V1 {
            return Err(RpcError::internal(format!(
                "The agent speaks ACP version {}, but Athas speaks version 1. Update the agent.",
                response.protocol_version.as_u16()
            )));
        }
        *self.agent_info.lock().unwrap_or_else(|p| p.into_inner()) = Some(response.clone());
        Ok(response)
    }

    fn client_capabilities(&self) -> acp::ClientCapabilities {
        let mut meta = acp::Meta::new();
        // The Claude and Codex adapters stream a command's output into the tool call's `_meta`
        // when the client says it shows it.
        meta.insert("terminal_output".into(), json!(true));
        // Agents that predate `auth.terminal` describe terminal sign-in under this key instead.
        meta.insert(super::LEGACY_TERMINAL_AUTH_META_KEY.into(), json!(true));
        meta.insert(
            "athas.dev".into(),
            json!({
                "extensionMethods": [
                    { "name": "_athas/open_terminal", "description": "Open a terminal tab in Athas", "params": { "command": "string|null" } },
                    { "name": "_athas/set_chat_title", "description": "Rename the active Athas chat title", "params": { "title": "string" } }
                ]
            }),
        );
        let has_host = self.host.is_some();
        acp::ClientCapabilities::new()
            .fs(acp::FileSystemCapabilities::new().read_text_file(has_host).write_text_file(has_host))
            .terminal(has_host)
            // The composer's sign-in runs a terminal method in a terminal tab.
            .auth(acp::AuthCapabilities::new().terminal(true))
            .elicitation(acp::ElicitationCapabilities::new().form(acp::ElicitationFormCapabilities::new()).url(acp::ElicitationUrlCapabilities::new()))
            .meta(meta)
    }

    pub async fn new_session(&self, cwd: &Path, mcp_servers: Vec<acp::McpServer>) -> Result<acp::NewSessionResponse, RpcError> {
        let request = acp::NewSessionRequest::new(cwd.to_path_buf()).mcp_servers(mcp_servers).additional_directories(self.additional_directories(cwd));
        self.rpc.request("session/new", request).await
    }

    /// The workspace's other roots the session should also cover, for an agent that takes them
    /// (`sessionCapabilities.additionalDirectories`).
    pub fn set_additional_directories(&self, directories: Vec<PathBuf>) {
        *self.additional_directories.lock().unwrap_or_else(|p| p.into_inner()) = directories;
    }

    fn additional_directories(&self, cwd: &Path) -> Vec<PathBuf> {
        let supported = self.agent_capabilities().is_some_and(|capabilities| capabilities.session_capabilities.additional_directories.is_some());
        if !supported {
            return Vec::new();
        }
        additional_directories(cwd, &self.additional_directories.lock().unwrap_or_else(|p| p.into_inner()))
    }

    /// Reopens `session_id`. With `suppress_replay`, the history the agent replays is dropped,
    /// because the view already shows it.
    pub async fn load_session(
        &self,
        session_id: &str,
        cwd: &Path,
        mcp_servers: Vec<acp::McpServer>,
        suppress_replay: bool,
    ) -> Result<acp::LoadSessionResponse, RpcError> {
        let request = acp::LoadSessionRequest::new(session_id.to_string(), cwd.to_path_buf()).mcp_servers(mcp_servers).additional_directories(self.additional_directories(cwd));
        let params = serde_json::to_value(request).map_err(RpcError::invalid_params)?;
        if suppress_replay {
            // Until the request has an id, drop history from the moment it is sent.
            *self.replay_session.lock().unwrap_or_else(|p| p.into_inner()) = Some(session_id.to_string());
            self.suppress_replay_until.store(REPLAY_STARTING, Ordering::SeqCst);
        }
        let (id, answer) = self.rpc.start_request("session/load", params);
        if suppress_replay {
            let _ = self.suppress_replay_until.compare_exchange(REPLAY_STARTING, id, Ordering::SeqCst, Ordering::SeqCst);
        }
        let result = answer.await;
        self.suppress_replay_until.store(NO_REPLAY, Ordering::SeqCst);
        serde_json::from_value(result?).map_err(|error| RpcError::internal(format!("Unexpected answer to session/load: {error}")))
    }

    /// The agent's own sessions in `cwd` (`session/list`), every page.
    pub async fn list_sessions(&self, cwd: &Path) -> Result<Vec<acp::SessionInfo>, RpcError> {
        let mut sessions = Vec::new();
        let mut cursor: Option<String> = None;
        for _ in 0..20 {
            let (page, next) = self.list_sessions_page(cwd, cursor).await?;
            sessions.extend(page);
            match next {
                Some(next) => cursor = Some(next),
                None => break,
            }
        }
        Ok(sessions)
    }

    /// One page of `session/list` from `cursor` (the first page without one), and the cursor of
    /// the next page when there is one (`AcpStreamHandler.listSessions`).
    pub async fn list_sessions_page(&self, cwd: &Path, cursor: Option<String>) -> Result<(Vec<acp::SessionInfo>, Option<String>), RpcError> {
        let response: acp::ListSessionsResponse = self.rpc.request("session/list", acp::ListSessionsRequest::new().cwd(cwd.to_path_buf()).cursor(cursor)).await?;
        Ok((response.sessions, response.next_cursor.filter(|next| !next.is_empty())))
    }

    /// Whether the agent advertised `sessionCapabilities.<name>` (`supports_session_capability`).
    pub fn supports_session_capability(&self, name: &str) -> bool {
        self.session_capability_names.lock().unwrap_or_else(|p| p.into_inner()).iter().any(|advertised| advertised == name)
    }

    /// Asks the agent to close a session it no longer needs to keep (`session/close`), when it
    /// supports that; the answer is not waited on past `timeout`, so a silent agent still idles.
    pub fn close_session(&self, session_id: &str, timeout: futures::future::LocalBoxFuture<'static, ()>) -> Option<futures::future::LocalBoxFuture<'static, ()>> {
        self.outside_read_grants.lock().unwrap_or_else(|p| p.into_inner()).remove(session_id);
        if let Ok(host) = self.host() {
            host.close_session_terminals(session_id);
        }
        if !self.supports_session_capability("close") {
            return None;
        }
        let params = serde_json::to_value(acp::CloseSessionRequest::new(session_id.to_string())).ok()?;
        let (id, answer) = self.rpc.start_request("session/close", params);
        let rpc = self.rpc.clone();
        Some(Box::pin(async move {
            futures::pin_mut!(answer);
            if let futures::future::Either::Right(_) = futures::future::select(answer, timeout).await {
                rpc.resolve(id, Err(RpcError::internal("The agent did not close the session in time")));
            }
        }))
    }

    /// Deletes one of the agent's own sessions (`session/delete`).
    pub async fn delete_session(&self, session_id: &str) -> Result<(), RpcError> {
        self.rpc.request::<_, Value>("session/delete", acp::DeleteSessionRequest::new(session_id.to_string())).await.map(|_| ())
    }

    /// An extension method of the agent, such as the Codex bridge's `_athas/codex_skills`.
    pub async fn ext_request(&self, method: &str, params: Value) -> Result<Value, RpcError> {
        self.rpc.request_value(method, params).await
    }

    /// Whether the agent deletes its sessions (`sessionCapabilities.delete`).
    pub fn supports_session_delete(&self) -> bool {
        self.agent_capabilities().is_some_and(|capabilities| capabilities.session_capabilities.delete.is_some())
    }

    /// Whether the agent lists its sessions (`sessionCapabilities.list`).
    pub fn supports_session_list(&self) -> bool {
        self.agent_capabilities().is_some_and(|capabilities| capabilities.session_capabilities.list.is_some())
    }

    /// Asks the view for an open editor's text before a file read goes to the disk, so the agent
    /// sees unsaved edits (`read_open_buffer`).
    pub fn read_open_buffers(&self) {
        self.open_buffer_reads.store(true, Ordering::SeqCst);
    }

    /// What an open editor holds for `path`, when the view answers reads from editors.
    async fn open_buffer(&self, session: Option<&str>, path: &Path) -> Option<String> {
        if !self.open_buffer_reads.load(Ordering::SeqCst) {
            return None;
        }
        let (respond, answer) = oneshot::channel();
        if !self.send_event(session, ClientEvent::BufferRead { path: path.to_path_buf(), respond }) {
            return None;
        }
        // An editor that does not answer within `BUFFER_READ_TIMEOUT` leaves the read to the disk.
        let timeout = deadline(BUFFER_READ_TIMEOUT);
        futures::pin_mut!(answer);
        match futures::future::select(answer, timeout).await {
            futures::future::Either::Left((answer, _)) => answer.ok().flatten(),
            futures::future::Either::Right(_) => None,
        }
    }

    pub fn set_preferred_auth(&self, method_id: Option<String>) {
        *self.preferred_auth.lock().unwrap_or_else(|p| p.into_inner()) = method_id;
    }

    pub fn preferred_auth(&self) -> Option<String> {
        self.preferred_auth.lock().unwrap_or_else(|p| p.into_inner()).clone()
    }

    pub async fn authenticate(&self, method_id: &str) -> Result<(), RpcError> {
        self.rpc.request::<_, Value>("authenticate", acp::AuthenticateRequest::new(method_id.to_string())).await.map(|_| ())
    }

    /// Whether the agent says it can log out (`agentCapabilities.auth.logout`).
    pub fn supports_logout(&self) -> bool {
        self.agent_capabilities()
            .and_then(|capabilities| serde_json::to_value(capabilities.auth).ok())
            .is_some_and(|auth| auth.get("logout").is_some_and(|logout| !logout.is_null()))
    }

    pub async fn logout(&self) -> Result<(), RpcError> {
        self.rpc.request_value("logout", json!({})).await.map(|_| ())
    }

    pub async fn prompt(&self, session_id: &str, prompt: Vec<acp::ContentBlock>) -> Result<acp::PromptResponse, RpcError> {
        self.prompt_with_meta(session_id, prompt, None).await
    }

    /// A prompt with `_meta`, such as the file the user edits for the built-in agent.
    pub async fn prompt_with_meta(&self, session_id: &str, prompt: Vec<acp::ContentBlock>, meta: Option<acp::Meta>) -> Result<acp::PromptResponse, RpcError> {
        self.rpc.request("session/prompt", acp::PromptRequest::new(session_id.to_string(), prompt).meta(meta)).await
    }

    pub fn cancel(&self, session_id: &str) {
        self.rpc.notify("session/cancel", acp::CancelNotification::new(session_id.to_string()));
    }

    pub async fn set_mode(&self, session_id: &str, mode_id: &str) -> Result<(), RpcError> {
        self.rpc
            .request::<_, Value>("session/set_mode", acp::SetSessionModeRequest::new(session_id.to_string(), mode_id.to_string()))
            .await
            .map(|_| ())
    }

    pub async fn set_config_option(
        &self,
        session_id: &str,
        config_id: &str,
        value: &str,
    ) -> Result<acp::SetSessionConfigOptionResponse, RpcError> {
        let params = json!({ "sessionId": session_id, "configId": config_id, "value": value });
        self.rpc.request("session/set_config_option", params).await
    }

    /// Hangs up: the agent's stdin closes.
    pub fn close(&self) {
        self.rpc.close();
    }

    /// Reads what the agent sends, in order: answers go to the requests waiting for them, updates
    /// and permission prompts to the view, and file and terminal requests to the host.
    async fn dispatch(self: Arc<Self>, mut incoming: mpsc::UnboundedReceiver<Incoming>) {
        let mut handlers: FuturesUnordered<BoxFuture<'static, (Value, Result<Value, RpcError>)>> = FuturesUnordered::new();
        loop {
            futures::select! {
                message = incoming.next() => match message {
                    Some(Incoming::Response { id, result }) => {
                        if self.suppress_replay_until.load(Ordering::SeqCst) == id {
                            self.suppress_replay_until.store(NO_REPLAY, Ordering::SeqCst);
                        }
                        self.rpc.resolve(id, result);
                    }
                    Some(Incoming::Notification { method, params }) => self.notification(&method, params),
                    Some(Incoming::Request { id, method, params }) => {
                        let this = self.clone();
                        handlers.push(async move { (id, this.request(&method, params).await) }.boxed());
                    }
                    None => break,
                },
                answered = handlers.select_next_some() => {
                    let (id, result) = answered;
                    self.rpc.respond(id, result);
                }
            }
        }
        self.closed.store(true, Ordering::Relaxed);
        self.rpc.fail_pending();
        // The view's event stream ends, which is how it learns the agent went away.
        self.events.close_channel();
        for sender in self.routes.lock().unwrap_or_else(|p| p.into_inner()).sessions.values() {
            sender.close_channel();
        }
    }

    fn notification(&self, method: &str, params: Value) {
        if method == "elicitation/complete" {
            if let Some(id) = params.get("elicitationId").and_then(Value::as_str) {
                self.send_event(None, ClientEvent::ElicitationComplete(id.to_string()));
            }
            return;
        }
        if method != "session/update" {
            return;
        }
        let Ok(notification) = serde_json::from_value::<acp::SessionNotification>(params) else {
            // An update kind this client does not know yet.
            return;
        };
        let session = notification.session_id.0.to_string();
        let replaying = self.replay_session.lock().unwrap_or_else(|p| p.into_inner()).as_ref().is_none_or(|replaying| *replaying == session);
        if replaying && self.suppress_replay_until.load(Ordering::SeqCst) != NO_REPLAY && is_history(&notification.update) {
            return;
        }
        self.send_event(Some(&session), ClientEvent::Update(notification.update));
    }

    async fn request(&self, method: &str, params: Value) -> Result<Value, RpcError> {
        fn parse<T: serde::de::DeserializeOwned>(params: Value) -> Result<T, RpcError> {
            serde_json::from_value(params).map_err(RpcError::invalid_params)
        }
        fn answer(value: impl serde::Serialize) -> Result<Value, RpcError> {
            serde_json::to_value(value).map_err(|error| RpcError::internal(error.to_string()))
        }
        let session = params.get("sessionId").and_then(Value::as_str).map(str::to_string);
        let session = session.as_deref();
        match method {
            "session/request_permission" => {
                let request: acp::RequestPermissionRequest = parse(params)?;
                let chosen = self.ask(session, request.tool_call, request.options).await;
                let outcome = match chosen {
                    Some(option) => acp::RequestPermissionOutcome::Selected(acp::SelectedPermissionOutcome::new(option)),
                    None => acp::RequestPermissionOutcome::Cancelled,
                };
                answer(acp::RequestPermissionResponse::new(outcome))
            }
            "elicitation/create" => {
                let (respond, answer) = oneshot::channel();
                if !self.send_event(session, ClientEvent::Elicitation(ElicitationRequest { request: params, respond })) {
                    return Ok(json!({ "action": "cancel" }));
                }
                Ok(answer.await.unwrap_or_else(|_| json!({ "action": "cancel" })))
            }
            "fs/read_text_file" => {
                let request: acp::ReadTextFileRequest = parse(params)?;
                let host = self.host()?;
                let path = host.resolve_path(&request.path);
                let mut asked = None;
                if !host.may_read(&path) && !self.has_outside_read_grant(session, &path) {
                    let options = outside_access_options(FileAccess::Read);
                    let tool_call = outside_access_tool_call(FileAccess::Read, &path, None, None);
                    asked = Some(tool_call.tool_call_id.clone());
                    let chosen = self.ask(session, tool_call, options).await;
                    match chosen.as_ref().map(|option| &*option.0) {
                        Some(ALLOW_ONCE) => {}
                        Some(ALLOW_FOLDER) => self.grant_outside_reads(session, &path),
                        _ => return Err(access_denied(&path)),
                    }
                }
                let content = match self.open_buffer(session, &path).await {
                    Some(text) => Ok(super::host::slice_lines(&text, request.line, request.limit)),
                    None => host.read_text_file(&path, request.line, request.limit),
                };
                self.finish_outside_access(session, asked, content.is_ok());
                answer(acp::ReadTextFileResponse::new(content?))
            }
            "fs/write_text_file" => {
                let request: acp::WriteTextFileRequest = parse(params)?;
                let host = self.host()?;
                let path = host.resolve_path(&request.path);
                let read = host.read_text_file(&path, None, None);
                // Unreadable (not UTF-8, no permission) is not missing: such a write is not put up
                // for review, since Reject and Restore would delete the file (`PriorContent::Unreadable`).
                let unreadable = read.is_err() && host.path_exists(&path);
                let previous = read.ok();
                if host.write_denied(&path).is_some() {
                    // Every write outside the project is asked about on its own, with its diff.
                    let options = outside_access_options(FileAccess::Write);
                    let tool_call = outside_access_tool_call(FileAccess::Write, &path, previous.clone(), Some(&request.content));
                    let id = tool_call.tool_call_id.clone();
                    let chosen = self.ask(session, tool_call, options).await;
                    if chosen.as_ref().map(|option| &*option.0) != Some(ALLOW_ONCE) {
                        return Err(access_denied(&path));
                    }
                    let written = host.write_allowed_file(&path, &request.content);
                    self.finish_outside_access(session, Some(id), written.is_ok());
                    written?;
                } else {
                    host.write_text_file(&path, &request.content)?;
                }
                if !unreadable {
                    self.send_event(session, ClientEvent::FileWritten { path, previous, content: request.content });
                }
                answer(acp::WriteTextFileResponse::new())
            }
            "terminal/create" => {
                let request: acp::CreateTerminalRequest = parse(params)?;
                let (events, route) = {
                    let routes = self.routes.lock().unwrap_or_else(|p| p.into_inner());
                    (self.events.clone(), if routes.shared { session.and_then(|session| routes.sessions.get(session).cloned()) } else { None })
                };
                let on_change = Arc::new(move |id: String| {
                    let _ = route.as_ref().unwrap_or(&events).unbounded_send(ClientEvent::TerminalChanged(id));
                });
                let id = self.host()?.create_terminal(&request, on_change)?;
                answer(acp::CreateTerminalResponse::new(id))
            }
            "terminal/output" => {
                let request: acp::TerminalOutputRequest = parse(params)?;
                answer(self.host()?.terminal_output(&request.terminal_id.0)?)
            }
            "terminal/wait_for_exit" => {
                let request: acp::WaitForTerminalExitRequest = parse(params)?;
                let exit = self.host()?.wait_for_terminal_exit(&request.terminal_id.0)?;
                let exit = exit.await.map_err(|_| RpcError::internal("The terminal went away"))?;
                answer(acp::WaitForTerminalExitResponse::new(exit.to_acp()))
            }
            "terminal/kill" => {
                let request: acp::KillTerminalRequest = parse(params)?;
                self.host()?.kill_terminal(&request.terminal_id.0)?;
                answer(json!({}))
            }
            "terminal/release" => {
                let request: acp::ReleaseTerminalRequest = parse(params)?;
                self.host()?.release_terminal(&request.terminal_id.0)?;
                answer(json!({}))
            }
            "_athas/open_terminal" => {
                let command = params.get("command").and_then(Value::as_str).map(str::to_string);
                self.send_event(session, ClientEvent::OpenTerminal(command));
                Ok(json!({ "success": true }))
            }
            "_athas/set_chat_title" => {
                let title = params
                    .get("title")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|title| !title.is_empty())
                    .ok_or_else(|| RpcError::new(-32602, "_athas/set_chat_title requires a title"))?;
                self.send_event(session, ClientEvent::SetTitle(title.to_string()));
                Ok(json!({ "success": true }))
            }
            other => Err(RpcError::method_not_found(other)),
        }
    }

    fn host(&self) -> Result<&Arc<dyn ClientHost>, RpcError> {
        self.host.as_ref().ok_or_else(|| RpcError::method_not_found("fs and terminals"))
    }

    pub fn terminal_snapshot(&self, id: &str) -> Option<super::host::TerminalSnapshot> {
        self.host.as_ref()?.terminal_snapshot(id)
    }

    async fn ask(&self, session: Option<&str>, tool_call: acp::ToolCallUpdate, options: Vec<acp::PermissionOption>) -> Option<acp::PermissionOptionId> {
        let (respond, chosen) = oneshot::channel();
        if !self.send_event(session, ClientEvent::Permission(PermissionRequest { tool_call, options, respond })) {
            return None;
        }
        chosen.await.ok().flatten()
    }

    /// Marks the prompt's row done once the allowed read or write ran; a denied one is marked
    /// by the view.
    fn finish_outside_access(&self, session: Option<&str>, asked: Option<acp::ToolCallId>, ok: bool) {
        let Some(id) = asked else { return };
        let status = if ok { acp::ToolCallStatus::Completed } else { acp::ToolCallStatus::Failed };
        let update = acp::ToolCallUpdate::new(id, acp::ToolCallUpdateFields::new().status(status));
        self.send_event(session, ClientEvent::Update(acp::SessionUpdate::ToolCallUpdate(update)));
    }

    /// Whether the user let `session` read the folder `path` lies in (`has_outside_read_grant`).
    fn has_outside_read_grant(&self, session: Option<&str>, path: &Path) -> bool {
        let Some(folder) = super::host::real_path(path).parent().map(Path::to_path_buf) else { return false };
        let grants = self.outside_read_grants.lock().unwrap_or_else(|p| p.into_inner());
        grants.get(session.unwrap_or_default()).is_some_and(|folders| folders.contains(&folder))
    }

    fn grant_outside_reads(&self, session: Option<&str>, path: &Path) {
        let Some(folder) = super::host::real_path(path).parent().map(Path::to_path_buf) else { return };
        let mut grants = self.outside_read_grants.lock().unwrap_or_else(|p| p.into_inner());
        grants.entry(session.unwrap_or_default().to_string()).or_default().insert(folder);
    }
}

/// Whether an update is part of a session's history (replayed by `session/load`) rather than its
/// current state.
fn is_history(update: &acp::SessionUpdate) -> bool {
    matches!(
        update,
        acp::SessionUpdate::UserMessageChunk(_)
            | acp::SessionUpdate::AgentMessageChunk(_)
            | acp::SessionUpdate::AgentThoughtChunk(_)
            | acp::SessionUpdate::ToolCall(_)
            | acp::SessionUpdate::ToolCallUpdate(_)
            | acp::SessionUpdate::Plan(_)
    )
}
