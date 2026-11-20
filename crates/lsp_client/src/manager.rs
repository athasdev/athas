//! The servers of a workbench, keyed by server and project root and started when the first file
//! that needs one opens, and the documents open in them.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Weak},
};

use lsp_types::{
    DidCloseTextDocumentParams, DidOpenTextDocumentParams, DidSaveTextDocumentParams, TextDocumentIdentifier, TextDocumentItem,
    Url,
    notification::{DidCloseTextDocument, DidOpenTextDocument, DidSaveTextDocument},
};
use parking_lot::Mutex;
use ropey::Rope;

use crate::{
    registry::{self, SearchPaths, ServerEntry},
    server::{EventSink, LanguageServer, ServerId},
    text::TextChange,
};

/// Why a file has no language server.
#[derive(Clone, Debug, PartialEq)]
pub enum OpenError {
    /// No server is known for the file's language.
    Unsupported,
    /// The server is known but not installed (not on PATH, not in Athas's tools).
    NotInstalled { server: String },
    Failed { server: String, message: String },
}

impl std::fmt::Display for OpenError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OpenError::Unsupported => write!(f, "No language server for this file"),
            OpenError::NotInstalled { server } => write!(f, "Language server not installed: {server}"),
            OpenError::Failed { server, message } => write!(f, "{server} could not start: {message}"),
        }
    }
}

/// Starts server processes; tests replace it with in-process servers.
pub trait Launcher: Send + Sync {
    fn launch(&self, id: ServerId, name: &str, entry: &ServerEntry, root: &Path, events: EventSink) -> Result<Arc<LanguageServer>, OpenError>;
}

/// Finds executables on PATH and in Athas's tools folders.
pub struct ProcessLauncher {
    paths: SearchPaths,
}

impl ProcessLauncher {
    pub fn new() -> Self {
        Self::with_paths(SearchPaths::system())
    }

    pub fn with_paths(paths: SearchPaths) -> Self {
        Self { paths }
    }
}

impl Default for ProcessLauncher {
    fn default() -> Self {
        Self::new()
    }
}

impl Launcher for ProcessLauncher {
    fn launch(&self, id: ServerId, name: &str, entry: &ServerEntry, root: &Path, events: EventSink) -> Result<Arc<LanguageServer>, OpenError> {
        let launch = registry::resolve(entry, &self.paths).ok_or_else(|| OpenError::NotInstalled { server: name.to_string() })?;
        let mut options = entry.initialization_options.clone();
        if name == "jdtls"
            && let Some(bundle) = self.paths.java_debug_bundle()
        {
            options = Some(registry::with_bundle(options, &bundle));
        }
        LanguageServer::spawn(id, name, &launch, root, options, events)
            .map_err(|error| OpenError::Failed { server: name.to_string(), message: format!("{error:#}") })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct ServerKey {
    pub server: String,
    pub root: PathBuf,
}

enum Slot {
    Running(Arc<LanguageServer>),
    Unavailable(OpenError),
}

/// A file open in a server. The editor holds it; dropping it closes the file in the server.
pub struct Document {
    pub path: PathBuf,
    pub uri: Url,
    pub language_id: String,
    server: Arc<LanguageServer>,
    version: Mutex<i32>,
}

impl Document {
    pub fn server(&self) -> &Arc<LanguageServer> {
        &self.server
    }

    pub fn version(&self) -> i32 {
        *self.version.lock()
    }

    pub fn identifier(&self) -> TextDocumentIdentifier {
        TextDocumentIdentifier::new(self.uri.clone())
    }

    /// Sends edits made since the last call; `text` is the whole text after them.
    pub fn change(&self, changes: Vec<TextChange>, text: &Rope) {
        if changes.is_empty() {
            return;
        }
        let mut version = self.version.lock();
        *version += 1;
        self.server.did_change(self.uri.clone(), *version, changes, text.clone());
    }

    pub fn saved(&self, text: &Rope) {
        let include_text = match self.server.capabilities().and_then(|capabilities| capabilities.text_document_sync.as_ref()) {
            Some(lsp_types::TextDocumentSyncCapability::Options(options)) => match &options.save {
                Some(lsp_types::TextDocumentSyncSaveOptions::SaveOptions(save)) => save.include_text.unwrap_or(false),
                _ => false,
            },
            _ => false,
        };
        self.server.notify::<DidSaveTextDocument>(DidSaveTextDocumentParams { text_document: self.identifier(), text: include_text.then(|| text.to_string()) });
    }
}

impl Drop for Document {
    fn drop(&mut self) {
        self.server.notify::<DidCloseTextDocument>(DidCloseTextDocumentParams { text_document: self.identifier() });
    }
}

pub struct ServerManager {
    launcher: Box<dyn Launcher>,
    events: EventSink,
    servers: HashMap<ServerKey, Slot>,
    names: HashMap<ServerId, ServerKey>,
    documents: HashMap<PathBuf, Weak<Document>>,
    next_id: ServerId,
    /// Checks in a row each running server had no open file, by key.
    idle: HashMap<ServerKey, u8>,
}

impl ServerManager {
    pub fn new(launcher: Box<dyn Launcher>, events: EventSink) -> Self {
        Self { launcher, events, servers: HashMap::new(), names: HashMap::new(), documents: HashMap::new(), next_id: 1, idle: HashMap::new() }
    }

    /// Opens `path` in its language server, starting the server for its project when needed.
    pub fn open(&mut self, path: &Path, text: &Rope, project_root: Option<&Path>) -> Result<Arc<Document>, OpenError> {
        let language = registry::language_for_path(path).ok_or(OpenError::Unsupported)?;
        let entry = registry::server(&language.server).ok_or(OpenError::Unsupported)?;
        let root = registry::root_for(path, project_root, &entry.root_markers);
        let key = ServerKey { server: language.server.clone(), root: root.clone() };
        let running = match self.servers.get(&key) {
            Some(Slot::Running(server)) if server.is_running() => Some(server.clone()),
            Some(Slot::Unavailable(error)) => return Err(error.clone()),
            _ => None,
        };
        let server = match running {
            Some(server) => server,
            None => {
                let id = self.next_id;
                self.next_id += 1;
                match self.launcher.launch(id, &language.server, entry, &root, self.events.clone()) {
                    Ok(server) => {
                        self.servers.insert(key.clone(), Slot::Running(server.clone()));
                        self.names.insert(id, key);
                        server
                    }
                    Err(error) => {
                        self.servers.insert(key, Slot::Unavailable(error.clone()));
                        return Err(error);
                    }
                }
            }
        };
        let uri = crate::uri::from_path(path).ok_or_else(|| OpenError::Failed { server: language.server.clone(), message: format!("{} is not an absolute path", path.display()) })?;
        server.notify::<DidOpenTextDocument>(DidOpenTextDocumentParams {
            text_document: TextDocumentItem { uri: uri.clone(), language_id: language.id.clone(), version: 0, text: text.to_string() },
        });
        let document = Arc::new(Document { path: path.to_path_buf(), uri, language_id: language.id.clone(), server, version: Mutex::new(0) });
        self.documents.insert(path.to_path_buf(), Arc::downgrade(&document));
        Ok(document)
    }

    /// The open document for `path`, if an editor holds one.
    pub fn document(&self, path: &Path) -> Option<Arc<Document>> {
        self.documents.get(path).and_then(Weak::upgrade)
    }

    pub fn is_open(&self, path: &Path) -> bool {
        self.document(path).is_some()
    }

    pub fn server(&self, id: ServerId) -> Option<Arc<LanguageServer>> {
        match self.servers.get(self.names.get(&id)?)? {
            Slot::Running(server) => Some(server.clone()),
            Slot::Unavailable(_) => None,
        }
    }

    pub fn server_name(&self, id: ServerId) -> Option<&str> {
        self.names.get(&id).map(|key| key.server.as_str())
    }

    /// The running servers, for a status display.
    pub fn servers(&self) -> Vec<Arc<LanguageServer>> {
        self.servers.values().filter_map(|slot| if let Slot::Running(server) = slot { Some(server.clone()) } else { None }).collect()
    }

    /// Why a server could not start, by key.
    pub fn unavailable(&self) -> Vec<(ServerKey, OpenError)> {
        self.servers.iter().filter_map(|(key, slot)| if let Slot::Unavailable(error) = slot { Some((key.clone(), error.clone())) } else { None }).collect()
    }

    /// A server process ended: the next file that needs it starts it again.
    pub fn server_exited(&mut self, id: ServerId, error: Option<String>) {
        let Some(key) = self.names.get(&id).cloned() else { return };
        if let Some(Slot::Running(server)) = self.servers.get(&key)
            && server.id() == id
        {
            match error {
                Some(message) if server.capabilities().is_none() => {
                    self.servers.insert(key.clone(), Slot::Unavailable(OpenError::Failed { server: key.server.clone(), message }));
                }
                _ => {
                    self.servers.remove(&key);
                }
            }
        }
        self.documents.retain(|_, document| document.upgrade().is_some_and(|document| document.server.id() != id));
    }

    /// Forgets failures so the next open tries again (after installing a server).
    pub fn retry_unavailable(&mut self) {
        self.servers.retain(|_, slot| matches!(slot, Slot::Running(_)));
    }

    /// Shuts one server down; the next file that needs it starts it again.
    pub fn shutdown(&mut self, id: ServerId) -> bool {
        let Some(key) = self.names.get(&id).cloned() else { return false };
        match self.servers.get(&key) {
            Some(Slot::Running(server)) if server.id() == id => server.shutdown(),
            _ => return false,
        }
        self.servers.remove(&key);
        self.documents.retain(|_, document| document.upgrade().is_some_and(|document| document.server.id() != id));
        true
    }

    /// Stops servers no open file has used for `checks` calls in a row (the Tauri app stops a
    /// server when its last file closes); returns how many stopped. Without this every server
    /// started stays until the app quits.
    pub fn reap_idle(&mut self, checks: u8) -> usize {
        self.documents.retain(|_, document| document.strong_count() > 0);
        let live: std::collections::HashSet<ServerId> = self.documents.values().filter_map(Weak::upgrade).map(|document| document.server.id()).collect();
        let mut stop = Vec::new();
        for (key, slot) in &self.servers {
            let Slot::Running(server) = slot else { continue };
            if live.contains(&server.id()) {
                self.idle.remove(key);
                continue;
            }
            let count = self.idle.entry(key.clone()).or_insert(0);
            *count += 1;
            if *count >= checks {
                stop.push(server.id());
            }
        }
        let stopped = stop.len();
        for id in stop {
            if let Some(key) = self.names.get(&id).cloned() {
                self.idle.remove(&key);
            }
            self.shutdown(id);
        }
        stopped
    }

    pub fn shutdown_all(&mut self) {
        for slot in self.servers.values() {
            if let Slot::Running(server) = slot {
                server.shutdown();
            }
        }
        self.servers.clear();
    }
}

impl Drop for ServerManager {
    fn drop(&mut self) {
        self.shutdown_all();
    }
}
