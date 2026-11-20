//! Language servers and agents for web workbenches: processes on this machine whose stdio is
//! relayed over the socket. Messages travel without their framing: the server frames what a client
//! sends (`Content-Length` headers for language servers, one line per message for ACP agents) and
//! unframes what the process writes.

use std::{
    collections::{HashMap, VecDeque},
    ffi::OsString,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        Arc, Mutex, MutexGuard,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

use web_protocol::{CallError, MAX_AGENTS, MAX_LANGUAGE_SERVERS, ServerMessage};

use crate::Hub;

/// How long a stopping process gets to exit after its client let go before it is killed.
const STOP_GRACE: Duration = Duration::from_secs(2);
const STDERR_LINES: usize = 20;

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// What a relay runs, and how its messages are framed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RelayKind {
    LanguageServer,
    Agent,
}

impl RelayKind {
    fn prefix(self) -> &'static str {
        match self {
            RelayKind::LanguageServer => "l",
            RelayKind::Agent => "a",
        }
    }

    fn limit(self) -> usize {
        match self {
            RelayKind::LanguageServer => MAX_LANGUAGE_SERVERS,
            RelayKind::Agent => MAX_AGENTS,
        }
    }

    fn noun(self) -> &'static str {
        match self {
            RelayKind::LanguageServer => "language server",
            RelayKind::Agent => "agent",
        }
    }

    fn failed(self) -> &'static str {
        match self {
            RelayKind::LanguageServer => "lsp_failed",
            RelayKind::Agent => "agent_failed",
        }
    }

    fn message(self, id: String, message: String) -> ServerMessage {
        match self {
            RelayKind::LanguageServer => ServerMessage::LspMessage { id, message },
            RelayKind::Agent => ServerMessage::AgentMessage { id, message },
        }
    }

    fn exit(self, id: String, error: Option<String>) -> ServerMessage {
        match self {
            RelayKind::LanguageServer => ServerMessage::LspExit { id, error },
            RelayKind::Agent => ServerMessage::AgentExit { id, error },
        }
    }

    fn read(self, reader: &mut impl BufRead) -> std::io::Result<Option<String>> {
        match self {
            RelayKind::LanguageServer => read_message(reader),
            RelayKind::Agent => read_line(reader),
        }
    }

    fn write(self, writer: &mut impl Write, message: &str) -> std::io::Result<()> {
        match self {
            RelayKind::LanguageServer => write!(writer, "Content-Length: {}\r\n\r\n{message}", message.len()),
            RelayKind::Agent => writeln!(writer, "{}", message.trim_end_matches(['\r', '\n'])),
        }
    }
}

pub(crate) struct RelayOptions {
    pub command: PathBuf,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    /// Absolute, inside the workspace.
    pub cwd: PathBuf,
    /// Replaces the process's `PATH`.
    pub path: Option<OsString>,
}

struct Relay {
    stdin: Mutex<ChildStdin>,
    child: Mutex<Child>,
    stopping: AtomicBool,
}

pub(crate) struct Relays {
    kind: RelayKind,
    root: PathBuf,
    hub: Arc<Hub>,
    next_id: AtomicU64,
    relays: Arc<Mutex<HashMap<String, Arc<Relay>>>>,
}

impl Relays {
    pub fn new(kind: RelayKind, root: PathBuf, hub: Arc<Hub>) -> Self {
        Self { kind, root, hub, next_id: AtomicU64::new(1), relays: Arc::default() }
    }

    fn get(&self, id: &str) -> Result<Arc<Relay>, CallError> {
        lock(&self.relays).get(id).cloned().ok_or_else(|| CallError::new("not_found", format!("No such {}.", self.kind.noun())))
    }

    pub fn start(&self, options: RelayOptions) -> Result<String, CallError> {
        let kind = self.kind;
        if lock(&self.relays).len() >= kind.limit() {
            return Err(CallError::invalid(format!("At most {} {}s can run.", kind.limit(), kind.noun())));
        }
        let mut command = Command::new(&options.command);
        command
            .args(&options.args)
            .envs(options.env.iter().map(|(key, value)| (key, value)))
            .current_dir(if options.cwd.is_dir() { &options.cwd } else { &self.root })
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(path) = &options.path {
            command.env("PATH", path);
        }
        let mut child = command.spawn().map_err(|error| {
            let code = if error.kind() == std::io::ErrorKind::NotFound { "not_installed" } else { kind.failed() };
            CallError::new(code, format!("Could not start {}: {error}", options.command.display()))
        })?;
        let (Some(stdin), Some(stdout), stderr) = (child.stdin.take(), child.stdout.take(), child.stderr.take()) else {
            let _ = child.kill();
            return Err(CallError::new(kind.failed(), format!("The {} has no stdio.", kind.noun())));
        };
        let relay = Arc::new(Relay { stdin: Mutex::new(stdin), child: Mutex::new(child), stopping: Default::default() });
        let id = format!("{}{}", kind.prefix(), self.next_id.fetch_add(1, Ordering::Relaxed));
        lock(&self.relays).insert(id.clone(), relay.clone());

        let stderr_tail = Arc::new(Mutex::new(VecDeque::<String>::new()));
        if let Some(stderr) = stderr {
            let tail = stderr_tail.clone();
            thread::Builder::new()
                .name(format!("athas-server-{id}-stderr"))
                .spawn(move || {
                    for line in BufReader::new(stderr).lines() {
                        let Ok(line) = line else { break };
                        let mut tail = lock(&tail);
                        if tail.len() == STDERR_LINES {
                            tail.pop_front();
                        }
                        tail.push_back(line);
                    }
                })
                .map_err(|error| CallError::new(kind.failed(), error.to_string()))?;
        }

        let hub = self.hub.clone();
        let registry = self.relays.clone();
        let thread_id = id.clone();
        thread::Builder::new()
            .name(format!("athas-server-{id}"))
            .spawn(move || {
                let mut reader = BufReader::new(stdout);
                while let Ok(Some(message)) = kind.read(&mut reader) {
                    hub.send(&kind.message(thread_id.clone(), message));
                }
                let status = lock(&relay.child).wait().ok();
                lock(&registry).remove(&thread_id);
                let error = (!relay.stopping.load(Ordering::SeqCst)).then(|| {
                    let tail = lock(&stderr_tail).iter().cloned().collect::<Vec<_>>().join("\n");
                    let status = status.map(|status| status.to_string()).unwrap_or_else(|| "exited".into());
                    if tail.is_empty() { status } else { format!("{status}: {tail}") }
                });
                hub.send(&kind.exit(thread_id, error));
            })
            .map_err(|error| CallError::new(kind.failed(), error.to_string()))?;
        Ok(id)
    }

    /// Frames `message` and writes it to the process's stdin.
    pub fn send(&self, id: &str, message: &str) -> Result<(), CallError> {
        let relay = self.get(id)?;
        let mut stdin = lock(&relay.stdin);
        self.kind.write(&mut *stdin, message).and_then(|_| stdin.flush()).map_err(|error| CallError::new(self.kind.failed(), error.to_string()))
    }

    /// Closes the process's stdin and kills it if it has not exited after a grace period.
    pub fn stop(&self, id: &str) -> Result<(), CallError> {
        let relay = lock(&self.relays).remove(id).ok_or_else(|| CallError::new("not_found", format!("No such {}.", self.kind.noun())))?;
        relay.stopping.store(true, Ordering::SeqCst);
        thread::Builder::new()
            .name("athas-server-relay-stop".into())
            .spawn(move || {
                let deadline = Instant::now() + STOP_GRACE;
                while Instant::now() < deadline {
                    if matches!(lock(&relay.child).try_wait(), Ok(Some(_))) {
                        return;
                    }
                    thread::sleep(Duration::from_millis(50));
                }
                let mut child = lock(&relay.child);
                let _ = child.kill();
                let _ = child.wait();
            })
            .map_err(|error| CallError::new(self.kind.failed(), error.to_string()))?;
        Ok(())
    }

    pub fn stop_all(&self) {
        let relays: Vec<Arc<Relay>> = lock(&self.relays).drain().map(|(_, relay)| relay).collect();
        for relay in relays {
            relay.stopping.store(true, Ordering::SeqCst);
            let mut child = lock(&relay.child);
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// Reads one `Content-Length` framed message; `None` at the end of the stream.
fn read_message(reader: &mut impl BufRead) -> std::io::Result<Option<String>> {
    let mut length: Option<usize> = None;
    let mut line = String::new();
    loop {
        line.clear();
        if reader.read_line(&mut line)? == 0 {
            return Ok(None);
        }
        let header = line.trim_end_matches(['\r', '\n']);
        if header.is_empty() {
            if length.is_some() {
                break;
            }
            continue;
        }
        if let Some((name, value)) = header.split_once(':')
            && name.trim().eq_ignore_ascii_case("content-length")
        {
            length = value.trim().parse().ok();
        }
    }
    let mut body = vec![0; length.unwrap_or(0)];
    reader.read_exact(&mut body)?;
    Ok(Some(String::from_utf8_lossy(&body).into_owned()))
}

/// Reads one newline-delimited message, skipping blank lines; `None` at the end of the stream.
fn read_line(reader: &mut impl BufRead) -> std::io::Result<Option<String>> {
    let mut line = String::new();
    loop {
        line.clear();
        if reader.read_line(&mut line)? == 0 {
            return Ok(None);
        }
        let message = line.trim_end_matches(['\r', '\n']);
        if !message.is_empty() {
            return Ok(Some(message.to_string()));
        }
    }
}
