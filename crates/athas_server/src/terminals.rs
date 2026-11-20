//! The workspace's terminals (`www/cloud/src/workspace-terminals.ts`): login shells on a PTY,
//! streamed to every connection as binary frames. They belong to the workspace rather than to a
//! connection, so a client that reconnects attaches to them again and gets the recent output back.

use std::{
    collections::{HashMap, VecDeque},
    io::{Read, Write},
    path::PathBuf,
    sync::{Arc, Condvar, Mutex, MutexGuard, atomic::{AtomicU64, Ordering}},
    thread,
};

use portable_pty::{ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};
use web_protocol::{CallError, MAX_TERMINALS, ServerMessage, TERMINAL_BACKLOG_BYTES, encode_terminal_frame};

use crate::{Hub, Outgoing};

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub(crate) struct TerminalOptions {
    pub cols: u16,
    pub rows: u16,
    /// Absolute, inside the workspace.
    pub cwd: PathBuf,
    pub env: Vec<(String, String)>,
    pub command: Option<(String, Vec<String>)>,
}

struct Terminal {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    paused: Mutex<bool>,
    resumed: Condvar,
    backlog: Mutex<VecDeque<u8>>,
}

pub(crate) struct Terminals {
    root: PathBuf,
    hub: Arc<Hub>,
    next_id: AtomicU64,
    terminals: Arc<Mutex<HashMap<String, Arc<Terminal>>>>,
}

impl Terminals {
    pub fn new(root: PathBuf, hub: Arc<Hub>) -> Self {
        Self { root, hub, next_id: AtomicU64::new(1), terminals: Arc::default() }
    }

    fn get(&self, id: &str) -> Result<Arc<Terminal>, CallError> {
        lock(&self.terminals).get(id).cloned().ok_or_else(|| CallError::new("not_found", "No such terminal."))
    }

    pub fn create(&self, options: TerminalOptions) -> Result<String, CallError> {
        if lock(&self.terminals).len() >= MAX_TERMINALS {
            return Err(CallError::invalid(format!("At most {MAX_TERMINALS} terminals can be open.")));
        }
        let failed = |error: anyhow::Error| CallError::new("terminal_failed", format!("{error:#}"));
        let pair = native_pty_system()
            .openpty(PtySize { rows: options.rows, cols: options.cols, pixel_width: 0, pixel_height: 0 })
            .map_err(failed)?;
        let mut command = match &options.command {
            Some((program, args)) => {
                let mut command = CommandBuilder::new(program);
                command.args(args);
                command
            }
            None => {
                let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
                let mut command = CommandBuilder::new(shell);
                command.arg("-l");
                command
            }
        };
        command.cwd(if options.cwd.is_dir() { &options.cwd } else { &self.root });
        for (key, value) in [("TERM", "xterm-256color"), ("COLORTERM", "truecolor"), ("TERM_PROGRAM", "athas")] {
            command.env(key, value);
        }
        for (key, value) in &options.env {
            command.env(key, value);
        }
        let mut child = pair.slave.spawn_command(command).map_err(failed)?;
        drop(pair.slave);
        let reader = pair.master.try_clone_reader().map_err(failed)?;
        let writer = pair.master.take_writer().map_err(failed)?;
        let terminal = Arc::new(Terminal {
            killer: Mutex::new(child.clone_killer()),
            master: Mutex::new(pair.master),
            writer: Mutex::new(writer),
            paused: Mutex::new(false),
            resumed: Condvar::new(),
            backlog: Mutex::default(),
        });
        let id = format!("t{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        lock(&self.terminals).insert(id.clone(), terminal.clone());

        let hub = self.hub.clone();
        let registry = self.terminals.clone();
        let weak = Arc::downgrade(&terminal);
        let thread_id = id.clone();
        thread::Builder::new()
            .name(format!("athas-server-{id}"))
            .spawn(move || {
                pump(reader, &weak, &thread_id, &hub);
                let exit_code = child.wait().ok().map(|status| status.exit_code() as i32);
                // A terminal closed on purpose has reported its exit already.
                let mut terminals = lock(&registry);
                let ours = terminals.get(&thread_id).is_some_and(|current| weak.upgrade().is_some_and(|terminal| Arc::ptr_eq(current, &terminal)));
                if ours {
                    terminals.remove(&thread_id);
                    drop(terminals);
                    hub.send(&ServerMessage::TerminalExit { id: thread_id, exit_code });
                }
            })
            .map_err(|error| CallError::new("terminal_failed", error.to_string()))?;
        Ok(id)
    }

    pub fn write(&self, id: &str, data: &[u8]) -> Result<(), CallError> {
        let terminal = self.get(id)?;
        let mut writer = lock(&terminal.writer);
        writer.write_all(data).and_then(|_| writer.flush()).map_err(|error| CallError::new("terminal_failed", error.to_string()))
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), CallError> {
        let terminal = self.get(id)?;
        lock(&terminal.master)
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|error| CallError::new("terminal_failed", format!("{error:#}")))
    }

    /// Stops reading output while the editor catches up; the PTY then blocks the shell.
    pub fn set_paused(&self, id: &str, paused: bool) -> Result<(), CallError> {
        let terminal = self.get(id)?;
        *lock(&terminal.paused) = paused;
        terminal.resumed.notify_all();
        Ok(())
    }

    pub fn backlog(&self, id: &str) -> Option<Vec<u8>> {
        let terminal = lock(&self.terminals).get(id).cloned()?;
        let backlog = lock(&terminal.backlog);
        Some(backlog.iter().copied().collect())
    }

    pub fn close(&self, id: &str) -> Result<(), CallError> {
        let terminal = lock(&self.terminals).remove(id).ok_or_else(|| CallError::new("not_found", "No such terminal."))?;
        *lock(&terminal.paused) = false;
        terminal.resumed.notify_all();
        let _ = lock(&terminal.killer).kill();
        self.hub.send(&ServerMessage::TerminalExit { id: id.into(), exit_code: None });
        Ok(())
    }

    pub fn close_all(&self) {
        let ids: Vec<String> = lock(&self.terminals).keys().cloned().collect();
        for id in ids {
            let _ = self.close(&id);
        }
    }

    pub fn list(&self) -> Vec<String> {
        let mut ids: Vec<String> = lock(&self.terminals).keys().cloned().collect();
        ids.sort_by_key(|id| id.trim_start_matches('t').parse::<u64>().unwrap_or(0));
        ids
    }
}

/// Streams a terminal's output to every connection, keeping the recent part for reattaching.
fn pump(mut reader: Box<dyn Read + Send>, terminal: &std::sync::Weak<Terminal>, id: &str, hub: &Hub) {
    let mut buffer = [0u8; 8192];
    loop {
        let read = match reader.read(&mut buffer) {
            Ok(0) | Err(_) => return,
            Ok(read) => read,
        };
        let Some(terminal) = terminal.upgrade() else { return };
        // While paused the output waits here, and the PTY stops the shell once its buffer fills.
        let mut paused = lock(&terminal.paused);
        while *paused {
            paused = terminal.resumed.wait(paused).unwrap_or_else(|poisoned| poisoned.into_inner());
        }
        drop(paused);
        let chunk = &buffer[..read];
        let mut backlog = lock(&terminal.backlog);
        backlog.extend(chunk);
        let excess = backlog.len().saturating_sub(TERMINAL_BACKLOG_BYTES);
        backlog.drain(..excess);
        drop(backlog);
        hub.broadcast(Outgoing::Binary(encode_terminal_frame(id, chunk)));
    }
}
