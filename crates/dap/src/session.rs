//! One debugging session: the handshake (initialize → launch or attach → breakpoints →
//! configurationDone), the paused program's threads, frames, scopes and variables, the controls,
//! evaluation and the console.

use std::{
    collections::{HashMap, HashSet},
    io::{BufRead as _, BufReader},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    rc::Rc,
    time::Duration,
};

use anyhow::{Result, anyhow};
use futures::{
    FutureExt as _, StreamExt as _,
    channel::{mpsc::UnboundedReceiver, oneshot},
    future::{Either, select},
};
use gpui::{App, AsyncApp, Context, Entity, EventEmitter, Subscription, Task, WeakEntity};
use serde_json::{Value, json};

use crate::{
    Adapter, BreakpointId, BreakpointState, BreakpointStore, BreakpointStoreEvent, Capabilities, EvaluateResult, ExecutionPosition, LaunchConfig,
    RequestKind, Scope, StackFrame, Thread, Variable,
    client::{DapClient, Incoming},
    types,
};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const DISCONNECT_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_OUTPUT_LINES: usize = 5000;
const STACK_LEVELS: u32 = 64;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SessionStatus {
    /// Starting the adapter and the handshake.
    Starting,
    Running,
    Stopped,
    Ended,
}

/// Why and where the program paused.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct StopInfo {
    /// "breakpoint", "step", "exception", "pause", "entry", …
    pub reason: String,
    pub description: Option<String>,
    pub text: Option<String>,
    pub thread_id: Option<i64>,
}

impl StopInfo {
    /// "Paused on breakpoint", "Paused on exception: ZeroDivisionError", …
    pub fn label(&self) -> String {
        let reason = match self.reason.as_str() {
            "function breakpoint" | "data breakpoint" | "instruction breakpoint" => "breakpoint",
            reason => reason,
        };
        let mut label = format!("Paused on {reason}");
        if let Some(detail) = self.text.as_ref().or(self.description.as_ref()).filter(|detail| !detail.eq_ignore_ascii_case(&label)) {
            label = format!("{label}: {detail}");
        }
        label
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum Loadable<T> {
    Loading,
    Loaded(T),
    Failed(String),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OutputCategory {
    Stdout,
    Stderr,
    /// Messages from the adapter or Athas about the session.
    Console,
    Important,
    /// What the user typed in the console.
    Input,
    /// What an expression typed in the console evaluated to.
    Result,
    Error,
    /// The adapter process's own log lines.
    Log,
}

#[derive(Clone, Debug, PartialEq)]
pub struct OutputLine {
    pub category: OutputCategory,
    pub text: String,
    /// Output events may end mid-line; the next one of the same kind continues it.
    complete: bool,
}

/// A debuggee the adapter asked Athas to start (`runInTerminal`).
#[derive(Clone, Debug, PartialEq)]
pub struct RunInTerminal {
    pub title: Option<String>,
    pub cwd: Option<PathBuf>,
    pub args: Vec<String>,
    /// `None` removes the variable.
    pub env: Vec<(String, Option<String>)>,
}

/// Starts a `runInTerminal` debuggee in the host's terminal and returns its process id if known.
pub type RunInTerminalHandler = Rc<dyn Fn(RunInTerminal, &mut App) -> Result<Option<u32>>>;

#[derive(Clone, Debug, PartialEq)]
pub enum SessionEvent {
    StatusChanged,
    /// The program paused; `position` is the selected frame's line.
    Stopped { position: Option<ExecutionPosition> },
    Output,
    Ended,
}

pub struct DebugSession {
    config: LaunchConfig,
    adapter_name: Option<String>,
    client: Option<Rc<DapClient>>,
    status: SessionStatus,
    ended_reason: Option<String>,
    capabilities_body: Value,
    capabilities: Capabilities,
    threads: Vec<Thread>,
    stop: Option<StopInfo>,
    selected_thread: Option<i64>,
    frames: Vec<StackFrame>,
    selected_frame: Option<i64>,
    scopes: Vec<Scope>,
    variables: HashMap<i64, Loadable<Vec<Variable>>>,
    output: Vec<OutputLine>,
    enabled_exception_filters: Vec<String>,
    /// Breakpoints may be sent once the adapter asked for its configuration.
    configured: bool,
    /// Bumped whenever the program moves on, so answers about an old pause are dropped.
    generation: u64,
    initialized: Option<oneshot::Sender<()>>,
    store: Entity<BreakpointStore>,
    /// Files whose breakpoints this session sent, so removing the last one clears it.
    sent_files: HashSet<PathBuf>,
    adapter_breakpoints: HashMap<i64, (PathBuf, BreakpointId)>,
    run_in_terminal: Option<RunInTerminalHandler>,
    debuggees: Vec<Child>,
    tasks: Vec<Task<()>>,
    inspect_task: Option<Task<()>>,
    _store_subscription: Subscription,
}

impl EventEmitter<SessionEvent> for DebugSession {}

impl DebugSession {
    /// Starts a session for a configuration whose variables are filled in. With no `adapter`, the
    /// adapter is found from the configuration's type; `cwd` is where it starts.
    pub fn new(
        config: LaunchConfig,
        cwd: PathBuf,
        adapter: Option<Adapter>,
        store: Entity<BreakpointStore>,
        cx: &mut Context<Self>,
    ) -> Self {
        let store_subscription = cx.subscribe(&store, |this: &mut Self, _, event: &BreakpointStoreEvent, cx| {
            if let BreakpointStoreEvent::Changed { path } = event
                && this.configured
                && this.status != SessionStatus::Ended
            {
                this.send_breakpoints(path.clone(), cx);
            }
        });
        let connect_config = config.clone();
        let task = cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            let connected = cx
                .background_executor()
                .spawn(async move {
                    let adapter = match adapter {
                        Some(adapter) => adapter,
                        None => crate::adapters::resolve(&connect_config, &cwd)?,
                    };
                    let (client, incoming) = adapter.connect()?;
                    anyhow::Ok((adapter, client, incoming))
                })
                .await;
            let (adapter, client, incoming) = match connected {
                Ok(connected) => connected,
                Err(error) => {
                    this.update(cx, |this, cx| this.end(format!("{error:#}"), cx)).ok();
                    return;
                }
            };
            let client = Rc::new(client);
            let Ok(initialized) = this.update(cx, |this, cx| this.connected(&adapter, client.clone(), incoming, cx)) else { return };
            if let Err(error) = Self::handshake(this.clone(), client, adapter, initialized, cx).await {
                this.update(cx, |this, cx| this.end(format!("{error:#}"), cx)).ok();
            }
        });
        Self {
            config,
            adapter_name: None,
            client: None,
            status: SessionStatus::Starting,
            ended_reason: None,
            capabilities_body: Value::Null,
            capabilities: Capabilities::default(),
            threads: Vec::new(),
            stop: None,
            selected_thread: None,
            frames: Vec::new(),
            selected_frame: None,
            scopes: Vec::new(),
            variables: HashMap::new(),
            output: Vec::new(),
            enabled_exception_filters: Vec::new(),
            configured: false,
            generation: 0,
            initialized: None,
            store,
            sent_files: HashSet::new(),
            adapter_breakpoints: HashMap::new(),
            run_in_terminal: None,
            debuggees: Vec::new(),
            tasks: vec![task],
            inspect_task: None,
            _store_subscription: store_subscription,
        }
    }

    /// Lets the host start `runInTerminal` debuggees in its terminal. Without one, Athas starts
    /// them itself and shows their output in the console.
    pub fn set_run_in_terminal(&mut self, handler: Option<RunInTerminalHandler>) {
        self.run_in_terminal = handler;
    }

    // What the view reads.

    pub fn config(&self) -> &LaunchConfig {
        &self.config
    }

    pub fn adapter_name(&self) -> Option<&str> {
        self.adapter_name.as_deref()
    }

    pub fn status(&self) -> SessionStatus {
        self.status
    }

    pub fn ended_reason(&self) -> Option<&str> {
        self.ended_reason.as_deref()
    }

    pub fn capabilities(&self) -> &Capabilities {
        &self.capabilities
    }

    pub fn stop_info(&self) -> Option<&StopInfo> {
        self.stop.as_ref()
    }

    pub fn threads(&self) -> &[Thread] {
        &self.threads
    }

    pub fn selected_thread(&self) -> Option<i64> {
        self.selected_thread
    }

    pub fn frames(&self) -> &[StackFrame] {
        &self.frames
    }

    pub fn selected_frame(&self) -> Option<i64> {
        self.selected_frame
    }

    pub fn scopes(&self) -> &[Scope] {
        &self.scopes
    }

    pub fn variables(&self, reference: i64) -> Option<&Loadable<Vec<Variable>>> {
        self.variables.get(&reference)
    }

    pub fn output(&self) -> &[OutputLine] {
        &self.output
    }

    pub fn exception_filter_enabled(&self, filter: &str) -> bool {
        self.enabled_exception_filters.iter().any(|enabled| enabled == filter)
    }

    pub fn is_active(&self) -> bool {
        self.status != SessionStatus::Ended
    }

    // The handshake.

    fn connected(
        &mut self,
        adapter: &Adapter,
        client: Rc<DapClient>,
        incoming: UnboundedReceiver<Incoming>,
        cx: &mut Context<Self>,
    ) -> oneshot::Receiver<()> {
        self.adapter_name = Some(adapter.name.clone());
        self.client = Some(client);
        self.push_output(OutputCategory::Console, format!("Started {}: {}", adapter.name, adapter.display()), cx);
        let (initialized_tx, initialized_rx) = oneshot::channel();
        self.initialized = Some(initialized_tx);
        let pump = cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            let mut incoming = incoming;
            while let Some(message) = incoming.next().await {
                let mut batch = vec![message];
                while let Ok(message) = incoming.try_recv() {
                    batch.push(message);
                }
                let handled = this.update(cx, |this, cx| {
                    for message in batch {
                        this.handle_incoming(message, cx);
                    }
                });
                if handled.is_err() {
                    break;
                }
            }
        });
        self.tasks.push(pump);
        initialized_rx
    }

    async fn handshake(
        this: WeakEntity<Self>,
        client: Rc<DapClient>,
        adapter: Adapter,
        initialized: oneshot::Receiver<()>,
        cx: &mut AsyncApp,
    ) -> Result<()> {
        let initialize = client.request(
            "initialize",
            json!({
                "clientID": "athas",
                "clientName": "Athas",
                "adapterID": adapter.kind,
                "locale": "en",
                "pathFormat": "path",
                "linesStartAt1": true,
                "columnsStartAt1": true,
                "supportsVariableType": true,
                "supportsVariablePaging": true,
                "supportsRunInTerminalRequest": true,
                "supportsStartDebuggingRequest": false,
                "supportsProgressReporting": false,
                "supportsInvalidatedEvent": false,
                "supportsMemoryReferences": false,
            }),
        );
        let capabilities = timeout(cx, "initialize", initialize).await?;
        let (request, arguments) = this.update(cx, |this, cx| {
            this.set_capabilities(capabilities, cx);
            let mut arguments = this.config.request_arguments();
            arguments["type"] = adapter.kind.clone().into();
            if adapter.name == "dlv" && this.config.request == RequestKind::Launch && arguments.get("mode").is_none() {
                arguments["mode"] = "debug".into();
            }
            if this.config.string("preLaunchTask").is_some() {
                this.push_output(OutputCategory::Console, "preLaunchTask is not run by Athas yet; run it first.".into(), cx);
            }
            (this.config.request.as_str(), arguments)
        })?;

        // Some adapters answer `launch` only after configurationDone, so wait for whichever of
        // `initialized` and a failed launch comes first.
        let launch = Box::pin(client.request(request, arguments));
        let initialized = Box::pin(initialized.map(|result| result.map_err(|_| anyhow!("the adapter closed before it was ready"))));
        let pending_launch = match select(initialized, launch).await {
            Either::Left((ready, launch)) => {
                ready?;
                Some(launch)
            }
            Either::Right((result, initialized)) => {
                result.map_err(|error| anyhow!("{request} failed: {error}"))?;
                timeout(cx, "the adapter to be ready", initialized).await?;
                None
            }
        };

        let configuration_done = this.update(cx, |this, cx| this.configure(cx))?;
        if let Some(done) = configuration_done {
            timeout(cx, "configurationDone", done).await?;
        }
        if let Some(launch) = pending_launch {
            timeout(cx, request, launch).await.map_err(|error| anyhow!("{request} failed: {error}"))?;
        }
        this.update(cx, |this, cx| {
            if this.status == SessionStatus::Starting {
                this.status = SessionStatus::Running;
                cx.emit(SessionEvent::StatusChanged);
                cx.notify();
            }
        })?;
        Ok(())
    }

    fn set_capabilities(&mut self, body: Value, cx: &mut Context<Self>) {
        self.capabilities = Capabilities::from_body(&body);
        self.capabilities_body = body;
        self.enabled_exception_filters =
            self.capabilities.exception_breakpoint_filters.iter().filter(|filter| filter.default).map(|filter| filter.filter.clone()).collect();
        cx.notify();
    }

    /// Sends every breakpoint and the exception filters, then configurationDone.
    fn configure(&mut self, cx: &mut Context<Self>) -> Option<futures::future::LocalBoxFuture<'static, Result<Value>>> {
        self.configured = true;
        let paths: Vec<PathBuf> = self.store.read(cx).files().map(|(path, _)| path.to_path_buf()).collect();
        for path in paths {
            self.send_breakpoints(path, cx);
        }
        let client = self.client.clone()?;
        if !self.capabilities.exception_breakpoint_filters.is_empty() {
            self.send_exception_filters(cx);
        }
        self.capabilities.supports_configuration_done_request.then(|| client.request("configurationDone", json!({})).boxed_local())
    }

    // What the adapter sends.

    fn handle_incoming(&mut self, message: Incoming, cx: &mut Context<Self>) {
        match message {
            Incoming::Event { event, body } => self.handle_event(&event, body, cx),
            Incoming::Request { seq, command, arguments } => self.handle_reverse_request(seq, &command, arguments, cx),
            Incoming::Log(line) => self.push_output(OutputCategory::Log, line, cx),
            Incoming::Closed(reason) => {
                if self.status != SessionStatus::Ended {
                    self.end(reason, cx);
                }
            }
        }
    }

    fn handle_event(&mut self, event: &str, body: Value, cx: &mut Context<Self>) {
        let text = |field: &str| body.get(field).and_then(Value::as_str).map(String::from);
        match event {
            "initialized" => {
                if let Some(initialized) = self.initialized.take() {
                    initialized.send(()).ok();
                }
            }
            "stopped" => {
                let thread_id = body.get("threadId").and_then(Value::as_i64);
                self.status = SessionStatus::Stopped;
                self.stop = Some(StopInfo {
                    reason: text("reason").unwrap_or_else(|| "pause".into()),
                    description: text("description"),
                    text: text("text"),
                    thread_id,
                });
                if thread_id.is_some() {
                    self.selected_thread = thread_id;
                }
                self.clear_inspection();
                self.inspect(cx);
                cx.emit(SessionEvent::StatusChanged);
                cx.notify();
            }
            "continued" => {
                // Left out, only `threadId` resumed (the DAP spec): a background thread going on must not
                // clear the stopped thread's frames.
                let all = body.get("allThreadsContinued").and_then(Value::as_bool).unwrap_or(false);
                let thread = body.get("threadId").and_then(Value::as_i64);
                if all || thread == self.selected_thread {
                    self.mark_running(cx);
                }
            }
            "thread" => self.refresh_threads(cx),
            "output" => {
                let category = match text("category").as_deref() {
                    Some("telemetry") => return,
                    Some("stdout") => OutputCategory::Stdout,
                    Some("stderr") => OutputCategory::Stderr,
                    Some("important") => OutputCategory::Important,
                    _ => OutputCategory::Console,
                };
                if let Some(output) = text("output") {
                    self.append_output(category, &output, cx);
                }
            }
            "breakpoint" => {
                let Some(breakpoint) = body.get("breakpoint") else { return };
                let Ok(result) = serde_json::from_value::<types::BreakpointResult>(breakpoint.clone()) else { return };
                let Some((path, id)) = result.id.and_then(|id| self.adapter_breakpoints.get(&id).cloned()) else { return };
                let state = BreakpointState { verified: Some(result.verified), message: result.message };
                self.store.update(cx, |store, cx| store.set_states(&path, vec![(id, state)], cx));
            }
            "capabilities" => {
                if let (Some(current), Some(changes)) =
                    (self.capabilities_body.as_object().cloned(), body.get("capabilities").and_then(Value::as_object))
                {
                    let mut merged = current;
                    merged.extend(changes.clone());
                    self.capabilities = Capabilities::from_body(&Value::Object(merged.clone()));
                    self.capabilities_body = Value::Object(merged);
                    cx.notify();
                }
            }
            "exited" => {
                let code = body.get("exitCode").and_then(Value::as_i64).unwrap_or_default();
                self.push_output(OutputCategory::Console, format!("Process exited with code {code}"), cx);
            }
            "terminated" => self.disconnect_and_end("the program finished".into(), cx),
            _ => {}
        }
    }

    fn handle_reverse_request(&mut self, seq: i64, command: &str, arguments: Value, cx: &mut Context<Self>) {
        let Some(client) = self.client.clone() else { return };
        if command != "runInTerminal" {
            client.respond(seq, command, Err(format!("Athas does not support `{command}` yet")));
            if command == "startDebugging" {
                self.push_output(OutputCategory::Error, "This adapter starts child sessions, which Athas does not support yet.".into(), cx);
            }
            return;
        }
        let request = RunInTerminal {
            title: arguments.get("title").and_then(Value::as_str).map(String::from),
            cwd: arguments.get("cwd").and_then(Value::as_str).filter(|cwd| !cwd.is_empty()).map(PathBuf::from),
            args: arguments.get("args").and_then(Value::as_array).map(|args| args.iter().filter_map(Value::as_str).map(String::from).collect()).unwrap_or_default(),
            env: arguments
                .get("env")
                .and_then(Value::as_object)
                .map(|env| env.iter().map(|(key, value)| (key.clone(), value.as_str().map(String::from))).collect())
                .unwrap_or_default(),
        };
        let result = match self.run_in_terminal.clone() {
            Some(handler) => handler(request, cx),
            None => self.spawn_debuggee(request, cx),
        };
        match result {
            Ok(Some(pid)) => client.respond(seq, command, Ok(json!({ "processId": pid }))),
            Ok(None) => client.respond(seq, command, Ok(json!({}))),
            Err(error) => {
                self.push_output(OutputCategory::Error, format!("{error:#}"), cx);
                client.respond(seq, command, Err(format!("{error:#}")));
            }
        }
    }

    /// Runs a `runInTerminal` debuggee without a terminal: its output goes to the console.
    fn spawn_debuggee(&mut self, request: RunInTerminal, cx: &mut Context<Self>) -> Result<Option<u32>> {
        let (program, args) = request.args.split_first().ok_or_else(|| anyhow!("the adapter gave no command to run"))?;
        let mut command = Command::new(program);
        command.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
        if let Some(cwd) = &request.cwd {
            command.current_dir(cwd);
        }
        for (key, value) in &request.env {
            match value {
                Some(value) => command.env(key, value),
                None => command.env_remove(key),
            };
        }
        let mut child = command.spawn().map_err(|error| anyhow!("could not start {program}: {error}"))?;
        let pid = child.id();
        let (tx, mut rx) = futures::channel::mpsc::unbounded::<(OutputCategory, String)>();
        for (category, stream) in [
            (OutputCategory::Stdout, child.stdout.take().map(|stream| Box::new(stream) as Box<dyn std::io::Read + Send>)),
            (OutputCategory::Stderr, child.stderr.take().map(|stream| Box::new(stream) as Box<dyn std::io::Read + Send>)),
        ] {
            let Some(stream) = stream else { continue };
            let tx = tx.clone();
            std::thread::spawn(move || {
                for line in BufReader::new(stream).lines() {
                    let Ok(line) = line else { break };
                    if tx.unbounded_send((category, line + "\n")).is_err() {
                        break;
                    }
                }
            });
        }
        self.debuggees.push(child);
        cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            while let Some((category, text)) = rx.next().await {
                if this.update(cx, |this, cx| this.append_output(category, &text, cx)).is_err() {
                    break;
                }
            }
        }).detach();
        Ok(Some(pid))
    }

    // The paused program.

    fn clear_inspection(&mut self) {
        self.generation += 1;
        self.frames.clear();
        self.selected_frame = None;
        self.scopes.clear();
        self.variables.clear();
        self.inspect_task = None;
    }

    fn mark_running(&mut self, cx: &mut Context<Self>) {
        if self.status == SessionStatus::Ended {
            return;
        }
        self.status = SessionStatus::Running;
        self.stop = None;
        self.clear_inspection();
        self.store.update(cx, |store, cx| store.set_execution_position(None, cx));
        cx.emit(SessionEvent::StatusChanged);
        cx.notify();
    }

    /// After a stop: threads, then the stopped thread's frames, then the top frame's scopes.
    fn inspect(&mut self, cx: &mut Context<Self>) {
        let Some(client) = self.client.clone() else { return };
        let generation = self.generation;
        self.inspect_task = Some(cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            let threads = client.request("threads", json!({})).await;
            let thread = this.update(cx, |this, cx| {
                if this.generation != generation {
                    return None;
                }
                match threads {
                    Ok(body) => this.threads = types::list(&body, "threads"),
                    Err(error) => this.push_output(OutputCategory::Error, format!("threads: {error}"), cx),
                }
                let thread = this
                    .selected_thread
                    .filter(|thread| this.threads.iter().any(|candidate| candidate.id == *thread) || this.threads.is_empty())
                    .or_else(|| this.threads.first().map(|thread| thread.id));
                this.selected_thread = thread;
                cx.notify();
                thread
            });
            let Ok(Some(thread)) = thread else { return };
            let frames = client.request("stackTrace", json!({ "threadId": thread, "startFrame": 0, "levels": STACK_LEVELS })).await;
            this.update(cx, |this, cx| {
                if this.generation != generation {
                    return;
                }
                match frames {
                    Ok(body) => this.set_frames(types::list(&body, "stackFrames"), true, cx),
                    Err(error) => this.push_output(OutputCategory::Error, format!("stackTrace: {error}"), cx),
                }
            })
            .ok();
        }));
    }

    fn refresh_threads(&mut self, cx: &mut Context<Self>) {
        let Some(client) = self.client.clone() else { return };
        cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            let Ok(body) = client.request("threads", json!({})).await else { return };
            this.update(cx, |this, cx| {
                this.threads = types::list(&body, "threads");
                cx.notify();
            })
            .ok();
        }).detach();
    }

    fn set_frames(&mut self, frames: Vec<StackFrame>, announce: bool, cx: &mut Context<Self>) {
        self.frames = frames;
        // The top frame with source; library frames without a file come after it.
        let frame = self.frames.iter().find(|frame| frame.path().is_some()).or(self.frames.first()).map(|frame| frame.id);
        if let Some(frame) = frame {
            self.select_frame(frame, cx);
        }
        if announce {
            cx.emit(SessionEvent::Stopped { position: self.selected_position() });
        }
        cx.notify();
    }

    fn selected_position(&self) -> Option<ExecutionPosition> {
        let frame = self.frames.iter().find(|frame| Some(frame.id) == self.selected_frame)?;
        Some(ExecutionPosition { path: frame.path()?, row: frame.line.saturating_sub(1) })
    }

    /// Shows another thread's frames.
    pub fn select_thread(&mut self, thread: i64, cx: &mut Context<Self>) {
        if self.status != SessionStatus::Stopped {
            return;
        }
        self.selected_thread = Some(thread);
        self.frames.clear();
        self.scopes.clear();
        self.selected_frame = None;
        let Some(client) = self.client.clone() else { return };
        let generation = self.generation;
        self.inspect_task = Some(cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            let frames = client.request("stackTrace", json!({ "threadId": thread, "startFrame": 0, "levels": STACK_LEVELS })).await;
            this.update(cx, |this, cx| {
                if this.generation != generation || this.selected_thread != Some(thread) {
                    return;
                }
                match frames {
                    Ok(body) => this.set_frames(types::list(&body, "stackFrames"), false, cx),
                    Err(error) => this.push_output(OutputCategory::Error, format!("stackTrace: {error}"), cx),
                }
            })
            .ok();
        }));
        cx.notify();
    }

    /// Shows a frame's scopes and moves the execution marker to it.
    pub fn select_frame(&mut self, frame: i64, cx: &mut Context<Self>) {
        self.selected_frame = Some(frame);
        self.scopes.clear();
        let position = self.selected_position();
        self.store.update(cx, |store, cx| store.set_execution_position(position, cx));
        let Some(client) = self.client.clone() else { return };
        let generation = self.generation;
        let task = cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            let scopes = client.request("scopes", json!({ "frameId": frame })).await;
            this.update(cx, |this, cx| {
                if this.generation != generation || this.selected_frame != Some(frame) {
                    return;
                }
                match scopes {
                    Ok(body) => {
                        this.scopes = types::list(&body, "scopes");
                        let eager: Vec<i64> =
                            this.scopes.iter().filter(|scope| !scope.expensive && scope.variables_reference > 0).map(|scope| scope.variables_reference).collect();
                        for reference in eager {
                            this.load_variables(reference, cx);
                        }
                    }
                    Err(error) => this.push_output(OutputCategory::Error, format!("scopes: {error}"), cx),
                }
                cx.notify();
            })
            .ok();
        });
        task.detach();
        cx.notify();
    }

    /// Fetches a scope's or a variable's children once; they stay until the program moves on.
    pub fn load_variables(&mut self, reference: i64, cx: &mut Context<Self>) {
        if reference <= 0 || self.variables.contains_key(&reference) {
            return;
        }
        let Some(client) = self.client.clone() else { return };
        self.variables.insert(reference, Loadable::Loading);
        let generation = self.generation;
        let task = cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            let variables = client.request("variables", json!({ "variablesReference": reference })).await;
            this.update(cx, |this, cx| {
                if this.generation != generation {
                    return;
                }
                let loaded = match variables {
                    Ok(body) => Loadable::Loaded(types::list(&body, "variables")),
                    Err(error) => Loadable::Failed(error.to_string()),
                };
                this.variables.insert(reference, loaded);
                cx.notify();
            })
            .ok();
        });
        task.detach();
        cx.notify();
    }

    /// `setVariable`: changes a variable of the scope or value `parent`, and shows the adapter's
    /// answer in place.
    pub fn set_variable(&mut self, parent: i64, name: &str, value: &str, cx: &mut Context<Self>) -> Task<Result<()>> {
        let Some(client) = self.client.clone() else { return Task::ready(Err(anyhow!("the session has ended"))) };
        let request = client.request("setVariable", json!({ "variablesReference": parent, "name": name, "value": value }));
        let name = name.to_string();
        let generation = self.generation;
        cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            let body = request.await?;
            this.update(cx, |this, cx| {
                if this.generation != generation {
                    return;
                }
                let mut stale = None;
                if let Some(Loadable::Loaded(variables)) = this.variables.get_mut(&parent)
                    && let Some(variable) = variables.iter_mut().find(|variable| variable.name == name)
                {
                    if let Some(value) = body.get("value").and_then(Value::as_str) {
                        variable.value = value.to_string();
                    }
                    if let Some(kind) = body.get("type").and_then(Value::as_str) {
                        variable.kind = Some(kind.to_string());
                    }
                    let reference = body.get("variablesReference").and_then(Value::as_i64).unwrap_or(0);
                    if reference != variable.variables_reference {
                        stale = Some(std::mem::replace(&mut variable.variables_reference, reference));
                    }
                }
                if let Some(stale) = stale {
                    this.variables.remove(&stale);
                }
                cx.notify();
            })?;
            Ok(())
        })
    }

    /// Any other request, such as java-debug's `redefineClasses`.
    pub fn custom_request(&self, command: &str, arguments: Value, cx: &mut Context<Self>) -> Task<Result<Value>> {
        let Some(client) = self.client.clone() else { return Task::ready(Err(anyhow!("the session has ended"))) };
        let request = client.request(command, arguments);
        cx.spawn(async move |_, _| request.await)
    }

    /// Evaluates an expression in the selected frame. `context` is "watch", "repl" or "hover".
    pub fn evaluate(&mut self, expression: &str, context: &str, cx: &mut Context<Self>) -> Task<Result<EvaluateResult>> {
        let Some(client) = self.client.clone() else { return Task::ready(Err(anyhow!("the session has ended"))) };
        let mut arguments = json!({ "expression": expression, "context": context });
        if let Some(frame) = self.selected_frame {
            arguments["frameId"] = frame.into();
        }
        let request = client.request("evaluate", arguments);
        cx.spawn(async move |_, _| Ok(serde_json::from_value(request.await?)?))
    }

    /// Evaluates what was typed in the console and prints the answer under it.
    pub fn evaluate_in_console(&mut self, expression: &str, cx: &mut Context<Self>) {
        let expression = expression.trim();
        if expression.is_empty() {
            return;
        }
        self.push_output(OutputCategory::Input, expression.to_string(), cx);
        let evaluation = self.evaluate(expression, "repl", cx);
        cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            let result = evaluation.await;
            this.update(cx, |this, cx| match result {
                Ok(result) => this.push_output(OutputCategory::Result, result.result, cx),
                Err(error) => this.push_output(OutputCategory::Error, error.to_string(), cx),
            })
            .ok();
        }).detach();
    }

    // Controls.

    fn current_thread(&self) -> Option<i64> {
        self.selected_thread.or(self.stop.as_ref().and_then(|stop| stop.thread_id)).or(self.threads.first().map(|thread| thread.id))
    }

    fn thread_request(&mut self, command: &'static str, cx: &mut Context<Self>) {
        let Some(client) = self.client.clone() else { return };
        let thread = match self.current_thread() {
            Some(thread) => thread,
            // Pausing a program that has not stopped yet: ask for its threads first.
            None if command == "pause" => {
                cx.spawn(async move |_, _| {
                    let Ok(body) = client.request("threads", json!({})).await else { return };
                    if let Some(thread) = types::list::<Thread>(&body, "threads").first() {
                        client.request("pause", json!({ "threadId": thread.id })).await.ok();
                    }
                }).detach();
                return;
            }
            None => return,
        };
        let stop = self.stop.clone();
        if command != "pause" {
            self.mark_running(cx);
        }
        let request = client.request(command, json!({ "threadId": thread }));
        cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            if let Err(error) = request.await {
                this.update(cx, |this, cx| {
                    this.push_output(OutputCategory::Error, format!("{command}: {error}"), cx);
                    // The adapter refused (Step Out at the top frame): the program is still paused
                    // where it was, so show it paused again instead of running with no frames.
                    if command != "pause" && this.status == SessionStatus::Running {
                        this.status = SessionStatus::Stopped;
                        this.stop = stop;
                        this.inspect(cx);
                        cx.emit(SessionEvent::StatusChanged);
                        cx.notify();
                    }
                })
                .ok();
            }
        }).detach();
    }

    pub fn resume(&mut self, cx: &mut Context<Self>) {
        if self.status == SessionStatus::Stopped {
            self.thread_request("continue", cx);
        }
    }

    pub fn pause(&mut self, cx: &mut Context<Self>) {
        if self.status == SessionStatus::Running {
            self.thread_request("pause", cx);
        }
    }

    pub fn step_over(&mut self, cx: &mut Context<Self>) {
        if self.status == SessionStatus::Stopped {
            self.thread_request("next", cx);
        }
    }

    pub fn step_in(&mut self, cx: &mut Context<Self>) {
        if self.status == SessionStatus::Stopped {
            self.thread_request("stepIn", cx);
        }
    }

    pub fn step_out(&mut self, cx: &mut Context<Self>) {
        if self.status == SessionStatus::Stopped {
            self.thread_request("stepOut", cx);
        }
    }

    /// Restarts in place when the adapter can; otherwise returns false and the caller starts a
    /// new session.
    pub fn restart_in_place(&mut self, cx: &mut Context<Self>) -> bool {
        if !self.capabilities.supports_restart_request || self.status == SessionStatus::Ended {
            return false;
        }
        let Some(client) = self.client.clone() else { return false };
        let request = client.request("restart", json!({ "arguments": self.config.request_arguments() }));
        self.mark_running(cx);
        self.push_output(OutputCategory::Console, "Restarting".into(), cx);
        cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            if let Err(error) = request.await {
                this.update(cx, |this, cx| this.push_output(OutputCategory::Error, format!("restart: {error}"), cx)).ok();
            }
        }).detach();
        true
    }

    /// Ends the session: the debuggee is terminated (launch) or detached from (attach).
    pub fn stop(&mut self, cx: &mut Context<Self>) {
        if self.status == SessionStatus::Ended {
            return;
        }
        self.disconnect_and_end("stopped".into(), cx);
    }

    fn disconnect_and_end(&mut self, reason: String, cx: &mut Context<Self>) {
        let Some(client) = self.client.clone() else {
            self.end(reason, cx);
            return;
        };
        let terminate = self.config.request == RequestKind::Launch;
        let disconnect = client.request("disconnect", json!({ "restart": false, "terminateDebuggee": terminate }));
        cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            let timer = cx.background_executor().timer(DISCONNECT_TIMEOUT);
            select(Box::pin(disconnect), timer).await;
            this.update(cx, |this, cx| this.end(reason, cx)).ok();
        }).detach();
    }

    fn end(&mut self, reason: String, cx: &mut Context<Self>) {
        if self.status == SessionStatus::Ended {
            return;
        }
        self.status = SessionStatus::Ended;
        self.stop = None;
        self.clear_inspection();
        self.push_output(OutputCategory::Console, format!("Session ended: {reason}"), cx);
        self.ended_reason = Some(reason);
        if let Some(client) = self.client.take() {
            client.shutdown();
        }
        for mut debuggee in self.debuggees.drain(..) {
            debuggee.kill().ok();
            std::thread::spawn(move || debuggee.wait());
        }
        self.initialized = None;
        self.store.update(cx, |store, cx| {
            store.set_execution_position(None, cx);
            store.clear_states(cx);
        });
        cx.emit(SessionEvent::StatusChanged);
        cx.emit(SessionEvent::Ended);
        cx.notify();
    }

    // Breakpoints.

    fn send_breakpoints(&mut self, path: PathBuf, cx: &mut Context<Self>) {
        let Some(client) = self.client.clone() else { return };
        let breakpoints: Vec<(BreakpointId, Value)> = self
            .store
            .read(cx)
            .breakpoints_for(&path)
            .iter()
            .filter(|breakpoint| breakpoint.enabled)
            .map(|breakpoint| {
                let mut source = json!({ "line": breakpoint.row + 1 });
                if let Some(condition) = &breakpoint.condition {
                    source["condition"] = condition.clone().into();
                }
                if let Some(hit_condition) = &breakpoint.hit_condition {
                    source["hitCondition"] = hit_condition.clone().into();
                }
                if let Some(log_message) = &breakpoint.log_message {
                    source["logMessage"] = log_message.clone().into();
                }
                (breakpoint.id, source)
            })
            .collect();
        if breakpoints.is_empty() && !self.sent_files.contains(&path) {
            return;
        }
        self.sent_files.insert(path.clone());
        let ids: Vec<BreakpointId> = breakpoints.iter().map(|(id, _)| *id).collect();
        let request = client.request(
            "setBreakpoints",
            json!({
                "source": { "path": path, "name": file_name(&path) },
                "breakpoints": breakpoints.into_iter().map(|(_, source)| source).collect::<Vec<_>>(),
                "sourceModified": false,
            }),
        );
        cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            let response = request.await;
            this.update(cx, |this, cx| {
                let states: Vec<(BreakpointId, BreakpointState)> = match response {
                    Ok(body) => {
                        let results: Vec<types::BreakpointResult> = types::list(&body, "breakpoints");
                        this.adapter_breakpoints.retain(|_, (file, _)| *file != path);
                        ids.iter()
                            .zip(results)
                            .map(|(id, result)| {
                                if let Some(adapter_id) = result.id {
                                    this.adapter_breakpoints.insert(adapter_id, (path.clone(), *id));
                                }
                                (*id, BreakpointState { verified: Some(result.verified), message: result.message })
                            })
                            .collect()
                    }
                    Err(error) => ids
                        .iter()
                        .map(|id| (*id, BreakpointState { verified: Some(false), message: Some(error.to_string()) }))
                        .collect(),
                };
                this.store.update(cx, |store, cx| store.set_states(&path, states, cx));
            })
            .ok();
        }).detach();
    }

    /// Turns stopping on an exception filter ("Uncaught Exceptions", …) on or off.
    pub fn set_exception_filter(&mut self, filter: &str, enabled: bool, cx: &mut Context<Self>) {
        self.enabled_exception_filters.retain(|existing| existing != filter);
        if enabled {
            self.enabled_exception_filters.push(filter.to_string());
        }
        if self.configured {
            self.send_exception_filters(cx);
        }
        cx.notify();
    }

    fn send_exception_filters(&mut self, cx: &mut Context<Self>) {
        let Some(client) = self.client.clone() else { return };
        let request = client.request("setExceptionBreakpoints", json!({ "filters": self.enabled_exception_filters }));
        cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            if let Err(error) = request.await {
                this.update(cx, |this, cx| this.push_output(OutputCategory::Error, format!("setExceptionBreakpoints: {error}"), cx)).ok();
            }
        }).detach();
    }

    // The console.

    fn push_output(&mut self, category: OutputCategory, text: String, cx: &mut Context<Self>) {
        self.output.push(OutputLine { category, text, complete: true });
        self.trim_output(cx);
    }

    /// Adds program output, joining a line that arrived in pieces.
    fn append_output(&mut self, category: OutputCategory, text: &str, cx: &mut Context<Self>) {
        let mut rest = text;
        while !rest.is_empty() {
            let (piece, complete, next) = match rest.find('\n') {
                Some(end) => (&rest[..end], true, &rest[end + 1..]),
                None => (rest, false, ""),
            };
            let piece = piece.trim_end_matches('\r');
            match self.output.last_mut() {
                Some(last) if !last.complete && last.category == category => {
                    last.text.push_str(piece);
                    last.complete = complete;
                }
                _ => self.output.push(OutputLine { category, text: piece.to_string(), complete }),
            }
            rest = next;
        }
        self.trim_output(cx);
    }

    fn trim_output(&mut self, cx: &mut Context<Self>) {
        if self.output.len() > MAX_OUTPUT_LINES {
            let excess = self.output.len() - MAX_OUTPUT_LINES;
            self.output.drain(..excess);
        }
        cx.emit(SessionEvent::Output);
        cx.notify();
    }

    pub fn clear_output(&mut self, cx: &mut Context<Self>) {
        self.output.clear();
        cx.notify();
    }
}

impl Drop for DebugSession {
    fn drop(&mut self) {
        if let Some(client) = &self.client {
            client.shutdown();
        }
        for debuggee in &mut self.debuggees {
            debuggee.kill().ok();
        }
    }
}

fn file_name(path: &Path) -> String {
    path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default()
}

async fn timeout<T>(cx: &AsyncApp, what: &str, future: impl Future<Output = Result<T>>) -> Result<T> {
    let timer = cx.background_executor().timer(REQUEST_TIMEOUT);
    match select(Box::pin(future), timer).await {
        Either::Left((result, _)) => result,
        Either::Right(_) => Err(anyhow!("timed out waiting for {what}")),
    }
}
