//! The workbench's language servers as a GPUI entity: server messages arrive here on the
//! foreground, diagnostics go to the `DiagnosticsStore` global, and edits for open files go to
//! their editors as events.

use std::{
    collections::{BTreeMap, HashMap},
    path::{Path, PathBuf},
    rc::Rc,
    sync::Arc,
};

use anyhow::{Result, anyhow};
use futures::{StreamExt as _, channel::mpsc};
use gpui::{App, AppContext as _, BorrowAppContext as _, Context, Entity, EventEmitter, Global, Task};
use lsp_types::{ExecuteCommandParams, MessageType, ProgressParams, ProgressParamsValue, PublishDiagnosticsParams, ShowMessageParams, TextEdit, WorkDoneProgress, WorkspaceEdit};
use ropey::Rope;
use serde_json::Value;

use crate::{
    diagnostics::DiagnosticsStore,
    edit::{self, FileOperation},
    manager::{Document, Launcher, OpenError, ProcessLauncher, ServerManager},
    server::{LanguageServer, ServerEvent, ServerId, ServerMessage},
};

#[derive(Clone, Debug)]
pub enum LspStoreEvent {
    /// Apply these edits to the open editor of `path` (a rename or code action in another file).
    EditDocument { path: PathBuf, edits: Vec<TextEdit> },
    /// A server finished starting; editors may ask it for hints and symbols.
    ServerReady(ServerId),
    /// A server asks clients to fetch inlay hints (or code lenses, …) again.
    Refresh { server: ServerId, method: String },
    ServerExited { server: ServerId, name: String, error: Option<String> },
    /// Missing and failed servers were forgotten (a server was installed); editors without one
    /// may open their file again.
    Retry,
}

/// A server's ongoing work (`$/progress`), for a status line.
#[derive(Clone, Debug, PartialEq)]
pub struct Progress {
    pub server: String,
    pub title: String,
    pub message: Option<String>,
    pub percentage: Option<u32>,
}

pub struct LspStore {
    manager: ServerManager,
    progress: BTreeMap<(ServerId, String), Progress>,
    /// The last error a server showed (`window/showMessage`).
    messages: HashMap<ServerId, String>,
    _pump: Task<()>,
}

impl EventEmitter<LspStoreEvent> for LspStore {}

struct GlobalLspStore(Entity<LspStore>);

impl Global for GlobalLspStore {}

#[derive(Clone)]
struct MissingServerHook(Rc<dyn Fn(&str, &mut App)>);

impl Global for MissingServerHook {}

/// Calls `hook` with a server's name each time a file needs it but it is not installed, so it
/// can be installed (the extension manager's tool repair).
pub fn on_missing_server(cx: &mut App, hook: impl Fn(&str, &mut App) + 'static) {
    cx.set_global(MissingServerHook(Rc::new(hook)));
}

/// Sets up the store and the diagnostics global. Safe to call more than once; editors call it.
pub fn init(cx: &mut App) {
    init_with(cx, || Box::new(ProcessLauncher::new()));
}

/// `init` with another way to start servers (tests).
pub fn init_with(cx: &mut App, launcher: impl FnOnce() -> Box<dyn Launcher>) {
    if cx.has_global::<GlobalLspStore>() {
        return;
    }
    if !cx.has_global::<DiagnosticsStore>() {
        cx.set_global(DiagnosticsStore::default());
    }
    let launcher = launcher();
    let store = cx.new(|cx| LspStore::new(launcher, cx));
    cx.set_global(GlobalLspStore(store.clone()));
    cx.on_app_quit(move |cx| {
        store.update(cx, |store, _| store.manager.shutdown_all());
        async {}
    })
    .detach();
}

impl LspStore {
    fn new(launcher: Box<dyn Launcher>, cx: &mut Context<Self>) -> Self {
        let (events, mut receiver) = mpsc::unbounded::<ServerEvent>();
        let pump = cx.spawn(async move |this, cx| {
            while let Some(event) = receiver.next().await {
                if this.update(cx, |store, cx| store.handle(event, cx)).is_err() {
                    break;
                }
            }
        });
        // Servers whose files all closed stop after a minute or two, not when the app quits.
        cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor().timer(std::time::Duration::from_secs(60)).await;
                if this.update(cx, |store, cx| {
                    if store.manager.reap_idle(2) > 0 {
                        cx.notify();
                    }
                })
                .is_err()
                {
                    break;
                }
            }
        })
        .detach();
        Self { manager: ServerManager::new(launcher, events), progress: BTreeMap::new(), messages: HashMap::new(), _pump: pump }
    }

    pub fn global(cx: &mut App) -> Entity<LspStore> {
        init(cx);
        cx.global::<GlobalLspStore>().0.clone()
    }

    pub fn try_global(cx: &App) -> Option<Entity<LspStore>> {
        cx.try_global::<GlobalLspStore>().map(|global| global.0.clone())
    }

    /// Opens a file in its language server (starting it on first use). The editor keeps the
    /// document and sends its edits through it; dropping it closes the file.
    pub fn open_document(&mut self, path: &Path, text: &Rope, project_root: Option<&Path>, cx: &mut Context<Self>) -> Result<Arc<Document>, OpenError> {
        let result = self.manager.open(path, text, project_root);
        if let Err(OpenError::NotInstalled { server }) = &result
            && let Some(hook) = cx.try_global::<MissingServerHook>().cloned()
        {
            let server = server.clone();
            let app: &mut App = cx;
            app.defer(move |cx| (hook.0)(&server, cx));
        }
        cx.notify();
        result
    }

    /// The open document of `path`, while an editor has it open.
    pub fn document(&self, path: &Path) -> Option<Arc<Document>> {
        self.manager.document(path)
    }

    pub fn server(&self, id: ServerId) -> Option<Arc<LanguageServer>> {
        self.manager.server(id)
    }

    pub fn servers(&self) -> Vec<Arc<LanguageServer>> {
        self.manager.servers()
    }

    /// Servers that could not start, with why.
    pub fn unavailable(&self) -> Vec<(String, OpenError)> {
        self.manager.unavailable().into_iter().map(|(key, error)| (key.server, error)).collect()
    }

    /// Forgets missing and failed servers so the next file tries again.
    pub fn retry_unavailable(&mut self, cx: &mut Context<Self>) {
        self.manager.retry_unavailable();
        cx.emit(LspStoreEvent::Retry);
        cx.notify();
    }

    /// Shuts every server down (`LSP: Stop All Servers`); editors lose their documents until a
    /// file needs a server again.
    pub fn stop_all(&mut self, cx: &mut Context<Self>) {
        let stopped: Vec<(ServerId, String)> = self.manager.servers().iter().map(|server| (server.id(), server.name().to_string())).collect();
        self.manager.shutdown_all();
        self.progress.clear();
        for (server, name) in stopped {
            self.messages.remove(&server);
            cx.update_global::<DiagnosticsStore, _>(|store, _| store.clear_server(server));
            cx.emit(LspStoreEvent::ServerExited { server, name, error: None });
        }
        cx.notify();
    }

    /// Shuts one server down (the status menu's stop button).
    pub fn stop_server(&mut self, id: ServerId, cx: &mut Context<Self>) {
        let Some(name) = self.manager.server_name(id).map(str::to_string) else { return };
        if !self.manager.shutdown(id) {
            return;
        }
        self.progress.retain(|(server, _), _| *server != id);
        self.messages.remove(&id);
        cx.update_global::<DiagnosticsStore, _>(|store, _| store.clear_server(id));
        cx.emit(LspStoreEvent::ServerExited { server: id, name, error: None });
        cx.notify();
    }

    /// Stops one server, then lets the editors that used it start it again.
    pub fn restart_server(&mut self, id: ServerId, cx: &mut Context<Self>) {
        self.stop_server(id, cx);
        cx.emit(LspStoreEvent::Retry);
    }

    /// Stops every server, then lets open editors start theirs again.
    pub fn restart_all(&mut self, cx: &mut Context<Self>) {
        self.stop_all(cx);
        cx.emit(LspStoreEvent::Retry);
    }

    /// A one-line summary for `LSP: Show Status`.
    pub fn status_summary(&self) -> (String, String) {
        let servers = self.manager.servers();
        let unavailable = self.manager.unavailable();
        let status = if !servers.is_empty() {
            "running"
        } else if !unavailable.is_empty() {
            "error"
        } else {
            "stopped"
        };
        let mut roots: Vec<String> = servers.iter().map(|server| format!("{} ({})", server.name(), server.root().display())).collect();
        roots.sort();
        let errors: Vec<String> = unavailable.iter().map(|(_, error)| error.to_string()).collect();
        let description = format!(
            "Active workspaces: {}\nError: {}",
            if roots.is_empty() { "None".to_string() } else { roots.join(", ") },
            if errors.is_empty() { "None".to_string() } else { errors.join("; ") }
        );
        (format!("LSP Status: {status}"), description)
    }

    /// `workspace/symbol` across the running servers whose root lies inside one of `roots`.
    pub fn workspace_symbols(&self, query: &str, roots: &[PathBuf]) -> impl std::future::Future<Output = Vec<crate::WorkspaceSymbol>> + use<> {
        let servers = self.manager.servers().into_iter().filter(|server| roots.iter().any(|root| server.root().starts_with(root))).collect();
        crate::symbols::workspace_symbols(servers, query.to_string())
    }

    pub fn progress(&self) -> Vec<Progress> {
        self.progress.values().cloned().collect()
    }

    pub fn last_message(&self, server: ServerId) -> Option<&str> {
        self.messages.get(&server).map(String::as_str)
    }

    /// The server that has `path` open, else the running server of its language whose root
    /// holds it (the original's `invokeForDocument`).
    pub fn server_for_path(&self, path: &Path) -> Option<Arc<LanguageServer>> {
        if let Some(document) = self.manager.document(path) {
            return Some(document.server().clone());
        }
        let name = crate::registry::language_for_path(path)?.server.clone();
        self.manager
            .servers()
            .into_iter()
            .filter(|server| server.name() == name && path.starts_with(server.root()))
            .max_by_key(|server| server.root().as_os_str().len())
    }

    /// `workspace/executeCommand` on the server of `path`. An answer that is a workspace edit
    /// (`java.edit.organizeImports`) is applied like one the server sends.
    pub fn execute_command(&self, path: &Path, command: &str, arguments: Vec<Value>, cx: &mut Context<Self>) -> Task<Result<Option<Value>>> {
        let Some(server) = self.server_for_path(path) else {
            return Task::ready(Err(anyhow!("No language server is running for {}", path.display())));
        };
        let request = server.request::<lsp_types::request::ExecuteCommand>(ExecuteCommandParams {
            command: command.to_string(),
            arguments,
            work_done_progress_params: Default::default(),
        });
        cx.spawn(async move |this, cx| {
            let result = request.await?;
            let edit = result
                .as_ref()
                .filter(|value| value.get("changes").is_some() || value.get("documentChanges").is_some())
                .and_then(|value| serde_json::from_value::<WorkspaceEdit>(value.clone()).ok());
            if let Some(edit) = edit {
                this.update(cx, |store, cx| store.apply_workspace_edit(&edit, cx))??;
            }
            Ok(result)
        })
    }

    /// Applies a workspace edit: open files through their editors, the rest on disk.
    pub fn apply_workspace_edit(&mut self, edit: &WorkspaceEdit, cx: &mut Context<Self>) -> Result<()> {
        let mut first_error = None;
        for operation in edit::operations(edit) {
            match operation {
                FileOperation::Edit { path, edits } if self.manager.is_open(&path) => cx.emit(LspStoreEvent::EditDocument { path, edits }),
                operation => {
                    if let Err(error) = edit::apply_on_disk(&operation) {
                        first_error.get_or_insert(error);
                    }
                }
            }
        }
        match first_error {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }

    fn handle(&mut self, event: ServerEvent, cx: &mut Context<Self>) {
        let server = event.server;
        match event.message {
            ServerMessage::Ready => cx.emit(LspStoreEvent::ServerReady(server)),
            ServerMessage::Notification { method, params } => match method.as_str() {
                "textDocument/publishDiagnostics" => {
                    if let Ok(params) = serde_json::from_value::<PublishDiagnosticsParams>(params) {
                        cx.update_global::<DiagnosticsStore, _>(|store, _| store.publish(server, params));
                    }
                }
                "$/progress" => {
                    if let Ok(params) = serde_json::from_value::<ProgressParams>(params) {
                        self.progress_changed(server, params);
                        cx.notify();
                    }
                }
                "window/showMessage" => {
                    if let Ok(params) = serde_json::from_value::<ShowMessageParams>(params)
                        && params.typ == MessageType::ERROR
                    {
                        self.messages.insert(server, params.message);
                        cx.notify();
                    }
                }
                _ => {}
            },
            ServerMessage::ApplyEdit { edit, reply } => {
                let applied = self.apply_workspace_edit(&edit, cx).is_ok();
                reply.send(applied).ok();
            }
            ServerMessage::Refresh(method) => cx.emit(LspStoreEvent::Refresh { server, method }),
            ServerMessage::Exited { error } => {
                let name = self.manager.server_name(server).unwrap_or_default().to_string();
                self.manager.server_exited(server, error.clone());
                self.progress.retain(|(id, _), _| *id != server);
                if let Some(error) = &error {
                    self.messages.insert(server, error.clone());
                }
                cx.update_global::<DiagnosticsStore, _>(|store, _| store.clear_server(server));
                cx.emit(LspStoreEvent::ServerExited { server, name, error });
                cx.notify();
            }
        }
    }

    fn progress_changed(&mut self, server: ServerId, params: ProgressParams) {
        let token = match params.token {
            lsp_types::NumberOrString::Number(number) => number.to_string(),
            lsp_types::NumberOrString::String(text) => text,
        };
        let key = (server, token);
        let ProgressParamsValue::WorkDone(progress) = params.value;
        match progress {
            WorkDoneProgress::Begin(begin) => {
                let name = self.manager.server_name(server).unwrap_or_default().to_string();
                self.progress.insert(key, Progress { server: name, title: begin.title, message: begin.message, percentage: begin.percentage });
            }
            WorkDoneProgress::Report(report) => {
                if let Some(progress) = self.progress.get_mut(&key) {
                    progress.message = report.message.or(progress.message.take());
                    progress.percentage = report.percentage.or(progress.percentage);
                }
            }
            WorkDoneProgress::End(_) => {
                self.progress.remove(&key);
            }
        }
    }
}
