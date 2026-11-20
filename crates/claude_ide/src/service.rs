//! The running server: a small tokio runtime for the old app's `IdeServer`, the bridge that hands
//! Claude's tool calls to the app's main thread, and the selection and workspace folders kept in
//! sync while it runs.

use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use athas_claude_ide::{BridgeEvent, EditorSelection, FrontendBridge, IdeServer, IdeServerConfig, SelectionPosition, ToolAnswer, default_lock_dir};
use futures::{StreamExt as _, channel::mpsc};
use gpui::{App, AsyncApp, Global, Task};

use crate::{
    diff_view::{self, PendingDiff},
    tools::{self, IdeDiagnostic, OpenEditor, Outcome, ToolEnv},
};

/// How long a tool call may wait on the app; `openDiff` waits on the user instead.
const TOOL_TIMEOUT: Duration = Duration::from_secs(15);
/// How often the selection and the folders are compared with what Claude was told.
const SYNC_INTERVAL: Duration = Duration::from_millis(150);
/// Puts the lock files somewhere else, for tests and development.
pub const LOCK_DIR_ENV: &str = "ATHAS_CLAUDE_IDE_LOCK_DIR";

struct Running {
    server: IdeServer,
    bridge: Arc<FrontendBridge>,
    runtime: tokio::runtime::Runtime,
    reported_selection: Option<EditorSelection>,
    reported_folders: Vec<String>,
    _tasks: Vec<Task<()>>,
}

#[derive(Default)]
struct ClaudeIde {
    running: Option<Running>,
    error: Option<String>,
}

impl Global for ClaudeIde {}

fn enabled(cx: &App) -> bool {
    cx.try_global::<settings::SettingsStore>().map(|_| settings::get(cx).claude_code_ide_integration).unwrap_or(false)
}

pub(crate) fn init(cx: &mut App) {
    cx.default_global::<ClaudeIde>();
    sync_enabled(cx);
    if cx.try_global::<settings::SettingsStore>().is_some() {
        cx.observe_global::<settings::SettingsStore>(sync_enabled).detach();
    }
}

fn sync_enabled(cx: &mut App) {
    let on = enabled(cx);
    let running = cx.global::<ClaudeIde>().running.is_some();
    if on && !running {
        if let Err(error) = start(cx) {
            cx.global_mut::<ClaudeIde>().error = Some(error);
        }
    } else if !on && running {
        stop(cx);
    }
}

fn lock_dir() -> Option<PathBuf> {
    std::env::var_os(LOCK_DIR_ENV).filter(|dir| !dir.is_empty()).map(PathBuf::from).or_else(default_lock_dir)
}

fn folders(cx: &App) -> Vec<String> {
    crate::bridge(cx).map(|bridge| bridge.workspace_folders(cx)).unwrap_or_default().into_iter().map(|path| path.to_string_lossy().into_owned()).collect()
}

/// Starts the runtime, the server and the lock file, and the tasks that serve them.
pub(crate) fn start_server(lock_dir: PathBuf, folders: Vec<String>, version: &str) -> Result<(tokio::runtime::Runtime, IdeServer, Arc<FrontendBridge>, mpsc::UnboundedReceiver<BridgeEvent>), String> {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(1)
        .thread_name("claude-ide")
        .enable_all()
        .build()
        .map_err(|error| error.to_string())?;
    let (events_tx, events) = mpsc::unbounded::<BridgeEvent>();
    let bridge = Arc::new(FrontendBridge::new(TOOL_TIMEOUT, Box::new(move |event| events_tx.unbounded_send(event.clone()).map_err(|error| error.to_string()))));
    let config = IdeServerConfig { ide_name: "Athas".into(), server_version: version.to_string(), lock_dir, workspace_folders: folders };
    let server = runtime
        .block_on(IdeServer::start(config, bridge.clone()))
        .map_err(|error| format!("Failed to start the Claude Code IDE server: {error}"))?;
    Ok((runtime, server, bridge, events))
}

fn start(cx: &mut App) -> Result<(), String> {
    let lock_dir = lock_dir().ok_or("Could not find the home directory")?;
    let folders = folders(cx);
    let (runtime, server, bridge, mut events) = start_server(lock_dir, folders.clone(), env!("CARGO_PKG_VERSION"))?;
    let requests = cx.spawn(async move |cx: &mut AsyncApp| {
        while let Some(event) = events.next().await {
            cx.update(|cx| handle_event(event, cx));
        }
    });
    let sync = cx.spawn(async move |cx: &mut AsyncApp| {
        loop {
            cx.background_executor().timer(SYNC_INTERVAL).await;
            cx.update(sync_state);
        }
    });
    let state = cx.global_mut::<ClaudeIde>();
    state.error = None;
    state.running = Some(Running { server, bridge, runtime, reported_selection: None, reported_folders: folders, _tasks: vec![requests, sync] });
    Ok(())
}

fn stop(cx: &mut App) {
    for request in diff_view::all_requests(cx) {
        diff_view::finish(&request, Some(false), cx);
    }
    if let Some(running) = cx.global_mut::<ClaudeIde>().running.take() {
        let Running { server, runtime, .. } = running;
        let guard = runtime.enter();
        drop(server);
        drop(guard);
        runtime.shutdown_background();
    }
}

fn to_protocol(selection: crate::Selection) -> EditorSelection {
    EditorSelection {
        file_path: selection.path.to_string_lossy().into_owned(),
        text: selection.text,
        start: SelectionPosition { line: selection.start.0, character: selection.start.1 },
        end: SelectionPosition { line: selection.end.0, character: selection.end.1 },
    }
}

/// Tells Claude about a changed selection or changed folders.
fn sync_state(cx: &mut App) {
    if cx.global::<ClaudeIde>().running.is_none() {
        return;
    }
    let bridge = crate::bridge(cx);
    let selection = bridge.as_ref().and_then(|bridge| bridge.selection(cx)).filter(|selection| selection.path.is_absolute()).map(to_protocol);
    let folders = folders(cx);
    let Some(running) = cx.global_mut::<ClaudeIde>().running.as_mut() else { return };
    if running.reported_selection != selection {
        running.server.update_selection(selection.clone());
        running.reported_selection = selection;
    }
    if running.reported_folders != folders {
        let _ = running.server.set_workspace_folders(folders.clone());
        running.reported_folders = folders;
    }
}

fn handle_event(event: BridgeEvent, cx: &mut App) {
    match event {
        BridgeEvent::Request(request) => {
            let Some(bridge) = cx.global::<ClaudeIde>().running.as_ref().map(|running| running.bridge.clone()) else { return };
            let outcome = tools::run_tool(&mut AppEnv { cx }, &request.request_id, &request.tool, &request.arguments);
            match outcome {
                Ok(Outcome::Answer(content)) => {
                    bridge.respond(&request.request_id, ToolAnswer { content, error: None });
                }
                Ok(Outcome::Diff(diff)) => {
                    let old_text = std::fs::read_to_string(&diff.old_file_path).unwrap_or_default();
                    let id = diff.request_id.clone();
                    diff_view::add(
                        PendingDiff {
                            request: diff,
                            old_text,
                            respond: Box::new(move |content| {
                                bridge.respond(&id, ToolAnswer { content, error: None });
                            }),
                        },
                        cx,
                    );
                }
                Err(error) => {
                    bridge.respond(&request.request_id, ToolAnswer { content: Vec::new(), error: Some(error) });
                }
            }
        }
        BridgeEvent::Cancel { request_id } => {
            diff_view::finish(&request_id, None, cx);
        }
    }
}

/// The tools' view of the app: the workbench's editors through the bridge, and diagnostics.
struct AppEnv<'a> {
    cx: &'a mut App,
}

impl ToolEnv for AppEnv<'_> {
    fn open_editors(&self) -> Vec<OpenEditor> {
        crate::bridge(self.cx).map(|bridge| bridge.open_editors(self.cx)).unwrap_or_default()
    }

    fn diagnostics(&self, path: Option<&Path>) -> Vec<(PathBuf, Vec<IdeDiagnostic>)> {
        let Some(store) = self.cx.try_global::<lsp_client::DiagnosticsStore>() else {
            return path.map(|path| vec![(path.to_path_buf(), Vec::new())]).unwrap_or_default();
        };
        let convert = |diagnostic: &lsp_client::Diagnostic| IdeDiagnostic {
            message: diagnostic.message.clone(),
            severity: match diagnostic.severity {
                lsp_client::Severity::Error => "Error",
                lsp_client::Severity::Warning => "Warning",
                lsp_client::Severity::Info => "Information",
                lsp_client::Severity::Hint => "Hint",
            },
            start: (diagnostic.range.start.line, diagnostic.range.start.character),
            end: (diagnostic.range.end.line, diagnostic.range.end.character),
            source: diagnostic.source.clone(),
            code: diagnostic.code.clone(),
        };
        match path {
            Some(path) => vec![(path.to_path_buf(), store.for_path(path).iter().map(convert).collect())],
            None => store.files().map(|(path, diagnostics)| (path.to_path_buf(), diagnostics.into_iter().map(convert).collect())).collect(),
        }
    }

    fn open_file(&mut self, path: &Path, selection: Option<std::ops::Range<usize>>) {
        match selection {
            Some(range) => workbench_api::open_file_selection(self.cx, path, range),
            None => workbench_api::open_file(self.cx, path, None),
        }
    }

    fn save(&mut self, path: &Path) -> Option<bool> {
        crate::bridge(self.cx)?.save(path, self.cx)
    }

    fn close_diff(&mut self, tab_name: &str) -> bool {
        diff_view::request_for_tab(tab_name, self.cx).is_some_and(|request| diff_view::finish(&request, Some(false), self.cx))
    }

    fn close_tab(&mut self, tab_name: &str) {
        if let Some(bridge) = crate::bridge(self.cx) {
            bridge.close_tab(tab_name, self.cx);
        }
    }

    fn close_all_diffs(&mut self) -> usize {
        diff_view::all_requests(self.cx).into_iter().filter(|request| diff_view::finish(request, Some(false), self.cx)).count()
    }

    fn workspace_root(&self) -> Option<PathBuf> {
        crate::bridge(self.cx).and_then(|bridge| bridge.workspace_folders(self.cx).into_iter().next())
    }

    fn read(&self, path: &Path) -> Option<String> {
        crate::bridge(self.cx).and_then(|bridge| bridge.editor_text(path, self.cx)).or_else(|| std::fs::read_to_string(path).ok())
    }
}

pub(crate) fn terminal_env(cx: &App) -> Vec<(String, String)> {
    cx.try_global::<ClaudeIde>()
        .and_then(|state| state.running.as_ref())
        .map(|running| running.server.terminal_env().into_iter().map(|(key, value)| (key.to_string(), value)).collect())
        .unwrap_or_default()
}

pub(crate) fn status(cx: &App) -> (bool, bool) {
    match cx.try_global::<ClaudeIde>().and_then(|state| state.running.as_ref()) {
        Some(running) => (true, running.server.has_clients()),
        None => (false, false),
    }
}

pub(crate) fn send_selection(cx: &mut App) -> Result<(), String> {
    let selection = crate::bridge(cx).and_then(|bridge| bridge.selection(cx)).ok_or("Open a file to send it to Claude Code")?;
    let running = cx.try_global::<ClaudeIde>().and_then(|state| state.running.as_ref()).ok_or("The Claude Code integration is off")?;
    if !running.server.has_clients() {
        return Err("Claude Code is not connected".into());
    }
    let range = (!selection.text.is_empty()).then_some((selection.start.0, selection.end.0));
    running.server.at_mention(&selection.path.to_string_lossy(), range.map(|range| range.0), range.map(|range| range.1));
    Ok(())
}
