//! The workspace server the web workbench runs against: a folder on this machine served over the
//! workspace protocol (`web_protocol`), the same one the cloud workspace Worker speaks. Files go
//! through the workbench's own file system and watcher (`file_tree::fs`), terminals run on the PTY
//! the desktop terminal uses, and git runs as the git command line in the folder.
//!
//! [`Workspace`] holds the folder and answers calls; [`serve`] puts it on a socket: a WebSocket
//! for calls, file changes, terminal output and language servers' messages, `POST /call` for
//! blocking calls, and the web build's files when it is given their folder.

mod agents;
mod github;
mod methods;
mod relays;
mod search;
mod serve;
mod services;
mod terminals;

use std::{
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex, mpsc},
    thread,
};

use anyhow::{Context as _, Result};
use file_tree::{Changes, Fs};
use serde_json::{Map, Value};
use web_protocol::{CallError, ChangeKind, FileChange, ServerMessage, WorkspaceInfo};

pub use github::Backend as GitHubBackend;
pub use serve::{ServerConfig, serve};
use relays::{RelayKind, Relays};
use terminals::Terminals;

/// What a connection sends its client.
#[derive(Clone, Debug, PartialEq)]
pub enum Outgoing {
    Text(String),
    Binary(Vec<u8>),
}

/// The connections that hear about file changes, terminal output and exits.
#[derive(Default)]
struct Hub {
    subscribers: Mutex<Vec<mpsc::Sender<Outgoing>>>,
}

impl Hub {
    fn subscribe(&self) -> mpsc::Receiver<Outgoing> {
        let (sender, receiver) = mpsc::channel();
        self.subscribers.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).push(sender);
        receiver
    }

    fn broadcast(&self, message: Outgoing) {
        self.subscribers
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .retain(|subscriber| subscriber.send(message.clone()).is_ok());
    }

    fn send(&self, message: &ServerMessage) {
        self.broadcast(Outgoing::Text(message.to_json()));
    }
}

/// A folder served to web workbenches.
pub struct Workspace {
    root: PathBuf,
    fs: Arc<dyn Fs>,
    hub: Arc<Hub>,
    terminals: Terminals,
    language_servers: Relays,
    agents: Relays,
    github: github::GitHub,
    services: services::Services,
    /// Grants reading the workspace's files as HTML previews (`/preview/<key>/…`), and nothing else.
    preview_key: String,
    stop_watching: Mutex<Option<mpsc::Sender<()>>>,
}

impl Workspace {
    /// Serves `root`, watching it for changes until the workspace is dropped.
    pub fn open(root: &Path) -> Result<Arc<Self>> {
        let root = root.canonicalize().with_context(|| format!("opening {}", root.display()))?;
        anyhow::ensure!(root.is_dir(), "{} is not a folder", root.display());
        let hub = Arc::new(Hub::default());
        let workspace = Arc::new(Self {
            fs: file_tree::local_fs(),
            terminals: Terminals::new(root.clone(), hub.clone()),
            language_servers: Relays::new(RelayKind::LanguageServer, root.clone(), hub.clone()),
            agents: Relays::new(RelayKind::Agent, root.clone(), hub.clone()),
            github: github::GitHub::default(),
            services: services::Services::default(),
            preview_key: random_key(),
            hub,
            root,
            stop_watching: Mutex::new(None),
        });
        workspace.watch()?;
        Ok(workspace)
    }

    /// The watcher's guard is not `Send`, so it lives on a thread of its own until the workspace
    /// goes.
    fn watch(&self) -> Result<()> {
        let (stop, stopped) = mpsc::channel::<()>();
        let (started, start) = mpsc::channel::<Result<()>>();
        let fs = self.fs.clone();
        let root = self.root.clone();
        let hub = self.hub.clone();
        thread::Builder::new().name("athas-server-watch".into()).spawn(move || {
            let callback_root = root.clone();
            let guard = fs.watch(&root, Box::new(move |changes| hub.send(&change_batch(&callback_root, changes))));
            let failed = guard.is_err();
            let _ = started.send(guard.as_ref().map(|_| ()).map_err(|error| anyhow::anyhow!("{error:#}")));
            if !failed {
                let _ = stopped.recv();
            }
            drop(guard);
        })?;
        start.recv().context("starting the file watcher")??;
        *self.stop_watching.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(stop);
        Ok(())
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn info(&self) -> WorkspaceInfo {
        let branch = Command::new("git")
            .args(["rev-parse", "--abbrev-ref", "HEAD"])
            .current_dir(&self.root)
            .output()
            .ok()
            .filter(|output| output.status.success())
            .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
            .unwrap_or_default();
        let name = self.root.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
        WorkspaceInfo {
            id: "local".into(),
            repo: name,
            branch,
            root: self.root.to_string_lossy().into_owned(),
            terminals: self.terminals.list(),
            stops_at: 0,
        }
    }

    /// Hears file changes, terminal output and exits from now on.
    pub fn subscribe(&self) -> mpsc::Receiver<Outgoing> {
        self.hub.subscribe()
    }

    /// A terminal's recent output, for a client that attaches to it again.
    pub fn terminal_backlog(&self, id: &str) -> Option<Vec<u8>> {
        self.terminals.backlog(id)
    }

    /// Makes the `github.*` calls that reach GitHub with `backend` instead of the GitHub client.
    pub fn set_github_backend(&self, backend: GitHubBackend) {
        self.github.set_backend(backend);
    }

    /// Runs `program` in place of `docker` for the Docker view.
    pub fn set_docker_program(&self, program: std::ffi::OsString) {
        self.services.set_docker_program(program);
    }

    /// Runs one protocol method.
    pub fn call(&self, method: &str, params: &Map<String, Value>) -> Result<Value, CallError> {
        methods::call(self, method, params)
    }
}

impl Drop for Workspace {
    fn drop(&mut self) {
        self.terminals.close_all();
        self.language_servers.stop_all();
        self.agents.stop_all();
        self.stop_watching.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).take();
    }
}

pub(crate) fn random_key() -> String {
    use std::io::Read as _;
    let mut bytes = [0u8; 16];
    if std::fs::File::open("/dev/urandom").and_then(|mut random| random.read_exact(&mut bytes)).is_err() {
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |elapsed| elapsed.as_nanos());
        bytes = (nanos ^ (std::process::id() as u128) << 64).to_le_bytes();
    }
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// One debounce window of the watcher, as the protocol reports it.
fn change_batch(root: &Path, changes: Changes) -> ServerMessage {
    let mut git_changed = false;
    let mut files = Vec::new();
    for path in changes.paths {
        let absolute = if path.is_absolute() { path } else { root.join(path) };
        let Some(relative) = web_protocol::relative_path(root, &absolute).filter(|relative| !relative.is_empty()) else { continue };
        if relative == ".git" || relative.starts_with(".git/") {
            git_changed |= !relative.starts_with(".git/objects/") && !relative.starts_with(".git/logs/");
            continue;
        }
        let file = match std::fs::symlink_metadata(&absolute) {
            Ok(metadata) => FileChange { path: relative, kind: ChangeKind::Modified, is_dir: metadata.is_dir() },
            Err(_) => FileChange { path: relative, kind: ChangeKind::Removed, is_dir: false },
        };
        files.push(file);
    }
    ServerMessage::FsChanges { changes: files, git_changed, rescan: changes.rescan }
}

#[cfg(test)]
mod tests;
