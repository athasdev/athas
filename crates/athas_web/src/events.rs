//! What the workspace socket pushes: file changes go to the watchers, terminal output and exits to
//! their terminals, language servers' and agents' messages to their clients, and terminal input
//! and agent messages wait here until the socket sends them.

use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        Arc, Mutex, MutexGuard, Weak,
        atomic::{AtomicU64, Ordering},
    },
};

use file_tree::Changes;
use futures::channel::mpsc::{UnboundedReceiver, UnboundedSender};
use lsp_client::LanguageServer;
use terminal_view::PtyIo;
use web_protocol::{ServerMessage, decode_terminal_frame};

type Watcher = Box<dyn Fn(Changes) + Send + Sync>;

/// An agent's session end: what it wrote goes to `incoming`, what the session sends waits in
/// `outgoing`.
struct AgentChannel {
    incoming: UnboundedSender<String>,
    outgoing: UnboundedReceiver<String>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub struct Events {
    root: PathBuf,
    next_watcher: AtomicU64,
    watchers: Mutex<Vec<(u64, Arc<Watcher>)>>,
    terminals: Mutex<HashMap<String, PtyIo>>,
    language_servers: Mutex<HashMap<String, Weak<LanguageServer>>>,
    agents: Mutex<HashMap<String, AgentChannel>>,
}

impl Events {
    pub fn new(root: PathBuf) -> Arc<Self> {
        Arc::new(Self { root, next_watcher: AtomicU64::new(1), watchers: Mutex::default(), terminals: Mutex::default(), language_servers: Mutex::default(), agents: Mutex::default() })
    }

    /// Hears file changes until the guard is dropped.
    pub fn watch(self: &Arc<Self>, watcher: Watcher) -> WatchGuard {
        let id = self.next_watcher.fetch_add(1, Ordering::Relaxed);
        lock(&self.watchers).push((id, Arc::new(watcher)));
        WatchGuard { events: Arc::downgrade(self), id }
    }

    pub(crate) fn add_terminal(&self, id: String, io: PtyIo) {
        lock(&self.terminals).insert(id, io);
    }

    pub(crate) fn remove_terminal(&self, id: &str) {
        lock(&self.terminals).remove(id);
    }

    pub(crate) fn add_language_server(&self, id: String, server: &Arc<LanguageServer>) {
        lock(&self.language_servers).insert(id, Arc::downgrade(server));
    }

    pub(crate) fn add_agent(&self, id: String, incoming: UnboundedSender<String>, outgoing: UnboundedReceiver<String>) {
        lock(&self.agents).insert(id, AgentChannel { incoming, outgoing });
    }

    pub(crate) fn remove_agent(&self, id: &str) {
        lock(&self.agents).remove(id);
    }

    /// A text message of the socket.
    pub fn handle_text(&self, text: &str) {
        if let Ok(message) = serde_json::from_str::<ServerMessage>(text) {
            self.handle(message);
        }
    }

    pub fn handle(&self, message: ServerMessage) {
        match message {
            ServerMessage::FsChanges { changes, rescan, .. } => {
                if changes.is_empty() && !rescan {
                    return;
                }
                let changes = Changes { paths: changes.into_iter().map(|change| crate::absolute(&self.root, &change.path)).collect(), rescan };
                // Watchers may watch again from their callbacks.
                let watchers: Vec<Arc<Watcher>> = lock(&self.watchers).iter().map(|(_, watcher)| watcher.clone()).collect();
                for watcher in watchers {
                    watcher(changes.clone());
                }
            }
            ServerMessage::TerminalExit { id, exit_code } => {
                let io = lock(&self.terminals).remove(&id);
                if let Some(io) = io {
                    (io.exited)(terminal_view::ExitStatus { code: exit_code, signal: None });
                }
            }
            ServerMessage::LspMessage { id, message } => {
                let server = lock(&self.language_servers).get(&id).and_then(Weak::upgrade);
                if let Some(server) = server {
                    server.receive(&message);
                }
            }
            ServerMessage::LspExit { id, error } => {
                let server = lock(&self.language_servers).remove(&id).and_then(|server| server.upgrade());
                if let Some(server) = server {
                    server.disconnected(error);
                }
            }
            ServerMessage::AgentMessage { id, message } => {
                if let Some(agent) = lock(&self.agents).get(&id) {
                    let _ = agent.incoming.unbounded_send(message);
                }
            }
            // Dropping the agent's sender ends its session's stream.
            ServerMessage::AgentExit { id, .. } => {
                lock(&self.agents).remove(&id);
            }
            _ => {}
        }
    }

    /// A binary message of the socket: terminal output.
    pub fn handle_binary(&self, frame: &[u8]) {
        let Some((id, data)) = decode_terminal_frame(frame) else { return };
        if let Some(io) = lock(&self.terminals).get_mut(&id) {
            (io.output)(data);
        }
    }

    /// What was typed into each terminal since the last call.
    pub fn take_input(&self) -> Vec<(String, Vec<u8>)> {
        let terminals = lock(&self.terminals);
        let mut input = Vec::new();
        for (id, io) in terminals.iter() {
            let mut bytes = Vec::new();
            while let Ok(chunk) = io.input.try_recv() {
                bytes.extend(chunk);
            }
            if !bytes.is_empty() {
                input.push((id.clone(), bytes));
            }
        }
        input
    }

    /// What each agent's session sent since the last call.
    pub fn take_agent_messages(&self) -> Vec<(String, String)> {
        let mut agents = lock(&self.agents);
        let mut messages = Vec::new();
        for (id, agent) in agents.iter_mut() {
            while let Ok(message) = agent.outgoing.try_recv() {
                messages.push((id.clone(), message));
            }
        }
        messages
    }
}

pub struct WatchGuard {
    events: Weak<Events>,
    id: u64,
}

impl Drop for WatchGuard {
    fn drop(&mut self) {
        if let Some(events) = self.events.upgrade() {
            lock(&events.watchers).retain(|(id, _)| *id != self.id);
        }
    }
}
