//! What the agent may do on this machine through the client: read and write text files, and run
//! commands in terminals. Ported from `crates/ai/src/acp/{client,file_access,terminal_state,
//! workspace_path}.rs`: reads and writes inside the project go ahead, ones outside ask the user
//! first (the client's `ensure_file_access`).

use std::{
    collections::HashMap,
    io::Read,
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

use agent_client_protocol_schema::v1 as acp;
use futures::channel::oneshot;

use super::rpc::RpcError;

/// Called whenever a terminal's output or state changes.
pub type ChangeListener = Arc<dyn Fn(String) + Send + Sync>;

/// A terminal's state, for showing it in a tool call.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct TerminalSnapshot {
    pub command: String,
    pub output: String,
    pub truncated: bool,
    pub exit: Option<TerminalExit>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TerminalExit {
    pub code: Option<u32>,
    pub signal: Option<String>,
}

impl TerminalExit {
    pub fn to_acp(&self) -> acp::TerminalExitStatus {
        acp::TerminalExitStatus::new().exit_code(self.code).signal(self.signal.clone())
    }
}

/// The machine side of the client: files and terminals, confined to the project's roots.
pub trait ClientHost: Send + Sync {
    /// Whether the agent may read `path` without asking.
    fn may_read(&self, path: &Path) -> bool;
    /// Why the agent may not write `path` without asking, if it may not.
    fn write_denied(&self, path: &Path) -> Option<String>;
    /// The absolute path an agent means by `path` (`resolve_path_against_workspace`): a relative
    /// one is taken against the session's folder, `.` and `..` resolved.
    fn resolve_path(&self, path: &Path) -> PathBuf;
    fn read_text_file(&self, path: &Path, line: Option<u32>, limit: Option<u32>) -> Result<String, RpcError>;
    /// Whether something is at `path`. A file that exists but cannot be read as text must not
    /// pass for a new one: rejecting an agent's write to a "new" file deletes it.
    fn path_exists(&self, path: &Path) -> bool {
        let _ = path;
        true
    }
    /// Writes `path` wherever it is: the user allowed this write.
    fn write_allowed_file(&self, path: &Path, content: &str) -> Result<(), RpcError>;
    /// Writes `path` when it lies inside the project.
    fn write_text_file(&self, path: &Path, content: &str) -> Result<(), RpcError> {
        if let Some(reason) = self.write_denied(path) {
            return Err(RpcError::internal(reason));
        }
        self.write_allowed_file(path, content)
    }
    fn create_terminal(&self, request: &acp::CreateTerminalRequest, on_change: ChangeListener) -> Result<String, RpcError>;
    fn terminal_output(&self, id: &str) -> Result<acp::TerminalOutputResponse, RpcError>;
    fn wait_for_terminal_exit(&self, id: &str) -> Result<oneshot::Receiver<TerminalExit>, RpcError>;
    fn kill_terminal(&self, id: &str) -> Result<(), RpcError>;
    fn release_terminal(&self, id: &str) -> Result<(), RpcError>;
    fn terminal_snapshot(&self, id: &str) -> Option<TerminalSnapshot>;
    /// Stops and forgets the terminals a session started, when that chat closes; other chats on
    /// the same agent keep theirs (`take_session_terminals`).
    fn close_session_terminals(&self, session_id: &str) {
        let _ = session_id;
    }
}

/// Files and processes on this machine.
pub struct LocalHost {
    roots: Vec<PathBuf>,
    cwd: PathBuf,
    terminals: Mutex<HashMap<String, Arc<TerminalState>>>,
}

impl LocalHost {
    pub fn new(cwd: PathBuf, roots: Vec<PathBuf>) -> Self {
        Self { roots, cwd, terminals: Mutex::default() }
    }

    fn terminal(&self, id: &str) -> Result<Arc<TerminalState>, RpcError> {
        self.terminals
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .get(id)
            .cloned()
            .ok_or_else(|| RpcError::internal(format!("No terminal {id}")))
    }
}

impl Drop for LocalHost {
    fn drop(&mut self) {
        for terminal in self.terminals.lock().unwrap_or_else(|p| p.into_inner()).values() {
            terminal.kill();
        }
    }
}

impl ClientHost for LocalHost {
    fn may_read(&self, path: &Path) -> bool {
        is_inside_roots(path, &self.roots)
    }

    fn write_denied(&self, path: &Path) -> Option<String> {
        (!is_inside_roots(path, &self.roots)).then(|| format!("{} is outside the project", path.display()))
    }

    fn path_exists(&self, path: &Path) -> bool {
        std::fs::symlink_metadata(path).is_ok()
    }

    fn read_text_file(&self, path: &Path, line: Option<u32>, limit: Option<u32>) -> Result<String, RpcError> {
        let content = std::fs::read_to_string(path)
            .map_err(|error| RpcError::new(RpcError::RESOURCE_NOT_FOUND, format!("Could not read {}: {error}", path.display())))?;
        Ok(slice_lines(&content, line, limit))
    }

    fn resolve_path(&self, path: &Path) -> PathBuf {
        lexical_normalize(&self.cwd.join(path))
    }

    fn write_allowed_file(&self, path: &Path, content: &str) -> Result<(), RpcError> {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        std::fs::write(path, content).map_err(|error| RpcError::internal(format!("Failed to write file: {error}")))
    }

    fn create_terminal(&self, request: &acp::CreateTerminalRequest, on_change: ChangeListener) -> Result<String, RpcError> {
        if request.command.trim().is_empty() {
            return Err(RpcError::new(RpcError::INVALID_PARAMS, "terminal/create command must not be empty"));
        }
        let cwd = request.cwd.clone().unwrap_or_else(|| self.cwd.clone());
        // Like a shell would run it: agents send `command` with `args`, or one shell line.
        let mut command = if request.args.is_empty() {
            let mut command = Command::new(if cfg!(windows) { "cmd" } else { "/bin/sh" });
            command.arg(if cfg!(windows) { "/C" } else { "-c" }).arg(&request.command);
            command
        } else {
            let mut command = Command::new(&request.command);
            command.args(&request.args);
            command
        };
        command.current_dir(&cwd).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
        if let Ok(path) = std::env::join_paths(super::agents::search_path()) {
            command.env("PATH", path);
        }
        for variable in &request.env {
            command.env(&variable.name, &variable.value);
        }
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        let mut child = command.spawn().map_err(|error| RpcError::internal(format!("Failed to start terminal: {error}")))?;

        static NEXT_TERMINAL: AtomicU64 = AtomicU64::new(1);
        let id = format!("term-{}", NEXT_TERMINAL.fetch_add(1, Ordering::Relaxed));
        let display = std::iter::once(request.command.as_str()).chain(request.args.iter().map(String::as_str)).collect::<Vec<_>>().join(" ");
        let state = Arc::new(TerminalState {
            pid: child.id(),
            session: request.session_id.to_string(),
            limit: request.output_byte_limit.map(|limit| limit as usize),
            inner: Mutex::new(TerminalInner { snapshot: TerminalSnapshot { command: display, ..Default::default() }, waiters: Vec::new() }),
        });

        let readers: Vec<_> = [
            child.stdout.take().map(|pipe| Box::new(pipe) as Box<dyn Read + Send>),
            child.stderr.take().map(|pipe| Box::new(pipe) as Box<dyn Read + Send>),
        ]
        .into_iter()
        .flatten()
        .map(|mut pipe| {
            let state = state.clone();
            let on_change = on_change.clone();
            let id = id.clone();
            std::thread::spawn(move || {
                let mut buffer = [0u8; 8192];
                let mut pending = Vec::new();
                loop {
                    let Ok(read) = pipe.read(&mut buffer) else { break };
                    if read == 0 {
                        break;
                    }
                    pending.extend_from_slice(&buffer[..read]);
                    let valid = utf8_prefix_len(&pending);
                    let text = String::from_utf8_lossy(&pending[..valid]).into_owned();
                    pending.drain(..valid);
                    state.append(&text);
                    on_change(id.clone());
                }
                if !pending.is_empty() {
                    state.append(&String::from_utf8_lossy(&pending));
                }
            })
        })
        .collect();

        let waiter_state = state.clone();
        let waiter_id = id.clone();
        std::thread::spawn(move || {
            // The process first: one that left a background job (`server &`) behind ends while
            // the job still holds its output open, and must be reported as ended. Its output so
            // far gets a moment to arrive.
            let status = child.wait().ok();
            let deadline = std::time::Instant::now() + std::time::Duration::from_millis(500);
            while readers.iter().any(|reader| !reader.is_finished()) && std::time::Instant::now() < deadline {
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            let exit = TerminalExit {
                code: status.and_then(|status| status.code()).map(|code| code as u32),
                signal: status.and_then(exit_signal),
            };
            waiter_state.finish(exit);
            on_change(waiter_id);
        });

        self.terminals.lock().unwrap_or_else(|p| p.into_inner()).insert(id.clone(), state);
        Ok(id)
    }

    fn terminal_output(&self, id: &str) -> Result<acp::TerminalOutputResponse, RpcError> {
        let snapshot = self.terminal(id)?.snapshot();
        Ok(acp::TerminalOutputResponse::new(snapshot.output, snapshot.truncated).exit_status(snapshot.exit.map(|exit| exit.to_acp())))
    }

    fn wait_for_terminal_exit(&self, id: &str) -> Result<oneshot::Receiver<TerminalExit>, RpcError> {
        let terminal = self.terminal(id)?;
        let (tx, rx) = oneshot::channel();
        let mut inner = terminal.inner.lock().unwrap_or_else(|p| p.into_inner());
        match &inner.snapshot.exit {
            Some(exit) => {
                let _ = tx.send(exit.clone());
            }
            None => inner.waiters.push(tx),
        }
        Ok(rx)
    }

    fn kill_terminal(&self, id: &str) -> Result<(), RpcError> {
        self.terminal(id)?.kill();
        Ok(())
    }

    fn release_terminal(&self, id: &str) -> Result<(), RpcError> {
        // The output stays readable for the tool call that showed it; only the process goes.
        self.terminal(id)?.kill();
        Ok(())
    }

    fn terminal_snapshot(&self, id: &str) -> Option<TerminalSnapshot> {
        self.terminal(id).ok().map(|terminal| terminal.snapshot())
    }

    fn close_session_terminals(&self, session_id: &str) {
        self.terminals.lock().unwrap_or_else(|p| p.into_inner()).retain(|_, terminal| {
            if terminal.session == session_id {
                terminal.kill();
                false
            } else {
                true
            }
        });
    }
}

struct TerminalState {
    #[cfg_attr(target_family = "wasm", allow(dead_code))]
    pid: u32,
    /// The chat that started it.
    session: String,
    limit: Option<usize>,
    inner: Mutex<TerminalInner>,
}

struct TerminalInner {
    snapshot: TerminalSnapshot,
    waiters: Vec<oneshot::Sender<TerminalExit>>,
}

impl TerminalState {
    fn append(&self, text: &str) {
        let mut inner = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        inner.snapshot.output.push_str(text);
        if let Some(limit) = self.limit
            && truncate_front(&mut inner.snapshot.output, limit)
        {
            inner.snapshot.truncated = true;
        }
    }

    fn finish(&self, exit: TerminalExit) {
        let mut inner = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        inner.snapshot.exit = Some(exit.clone());
        for waiter in inner.waiters.drain(..) {
            let _ = waiter.send(exit.clone());
        }
    }

    fn snapshot(&self) -> TerminalSnapshot {
        self.inner.lock().unwrap_or_else(|p| p.into_inner()).snapshot.clone()
    }

    fn kill(&self) {
        if self.inner.lock().unwrap_or_else(|p| p.into_inner()).snapshot.exit.is_some() {
            return;
        }
        #[cfg(unix)]
        super::process::signal_group(self.pid, libc::SIGKILL);
    }
}

#[cfg(unix)]
fn exit_signal(status: std::process::ExitStatus) -> Option<String> {
    use std::os::unix::process::ExitStatusExt;
    status.signal().map(|signal| match signal {
        libc::SIGKILL => "SIGKILL".to_string(),
        libc::SIGTERM => "SIGTERM".to_string(),
        libc::SIGINT => "SIGINT".to_string(),
        other => format!("signal {other}"),
    })
}

#[cfg(not(unix))]
fn exit_signal(_: std::process::ExitStatus) -> Option<String> {
    None
}

/// How much of `bytes` is whole UTF-8 characters; a character split across reads waits for the
/// rest of it.
fn utf8_prefix_len(bytes: &[u8]) -> usize {
    match std::str::from_utf8(bytes) {
        Ok(_) => bytes.len(),
        Err(error) if error.error_len().is_none() => error.valid_up_to(),
        Err(_) => bytes.len(),
    }
}

/// Drops the start of `text` so it fits `limit` bytes, cutting at a character boundary. Returns
/// whether anything was dropped.
pub fn truncate_front(text: &mut String, limit: usize) -> bool {
    if text.len() <= limit {
        return false;
    }
    let mut start = text.len() - limit;
    while !text.is_char_boundary(start) {
        start += 1;
    }
    text.drain(..start);
    true
}

/// The lines `line` (1-based) onwards, at most `limit` of them.
pub fn slice_lines(content: &str, line: Option<u32>, limit: Option<u32>) -> String {
    if line.is_none() && limit.is_none() {
        return content.to_string();
    }
    let start = line.map_or(0, |line| line.saturating_sub(1) as usize);
    let lines = content.split_inclusive('\n').skip(start);
    match limit {
        Some(limit) => lines.take(limit as usize).collect(),
        None => lines.collect(),
    }
}

/// Whether `path` lies inside one of `roots`, following symlinks so a link cannot lead out.
pub fn is_inside_roots(path: &Path, roots: &[PathBuf]) -> bool {
    if !path.is_absolute() {
        return false;
    }
    let path = real_path(path);
    roots.iter().any(|root| path.starts_with(real_path(root)))
}

/// The path with `.` and `..` resolved and the longest existing prefix's symlinks followed.
pub(crate) fn real_path(path: &Path) -> PathBuf {
    let normalized = lexical_normalize(path);
    let mut existing = normalized.clone();
    let mut rest = Vec::new();
    while !existing.exists() {
        let Some(name) = existing.file_name().map(|name| name.to_os_string()) else { break };
        rest.push(name);
        if !existing.pop() {
            break;
        }
    }
    let mut real = std::fs::canonicalize(&existing).unwrap_or(existing);
    for name in rest.into_iter().rev() {
        real.push(name);
    }
    real
}

fn lexical_normalize(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::ParentDir => {
                normalized.pop();
            }
            Component::CurDir => {}
            other => normalized.push(other.as_os_str()),
        }
    }
    normalized
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_the_agent_inside_the_project() {
        let project = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let roots = vec![project.path().to_path_buf()];
        assert!(is_inside_roots(&project.path().join("src/new.rs"), &roots));
        assert!(!is_inside_roots(&project.path().join("../elsewhere.rs"), &roots));
        assert!(!is_inside_roots(&outside.path().join("a.rs"), &roots));
        assert!(!is_inside_roots(Path::new("relative.rs"), &roots));
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(outside.path(), project.path().join("link")).unwrap();
            assert!(!is_inside_roots(&project.path().join("link/a.rs"), &roots));
        }

        let host = LocalHost::new(project.path().to_path_buf(), roots);
        let inside = project.path().join("dir/file.txt");
        host.write_text_file(&inside, "one\ntwo\nthree\n").unwrap();
        assert_eq!(host.read_text_file(&inside, Some(2), Some(1)).unwrap(), "two\n");
        assert!(host.write_text_file(&outside.path().join("x.txt"), "no").is_err());
        assert!(!outside.path().join("x.txt").exists());
    }

    #[test]
    fn truncates_output_from_the_front_at_a_character_boundary() {
        let mut text = "aé日本".to_string();
        assert!(truncate_front(&mut text, 4));
        assert_eq!(text, "本");
        let mut short = "ok".to_string();
        assert!(!truncate_front(&mut short, 10));
    }

    #[cfg(unix)]
    #[test]
    fn runs_commands_in_terminals() {
        let dir = tempfile::tempdir().unwrap();
        let host = LocalHost::new(dir.path().to_path_buf(), vec![dir.path().to_path_buf()]);
        let request = acp::CreateTerminalRequest::new("s", "printf 'hello'; echo oops >&2; exit 3");
        let id = host.create_terminal(&request, Arc::new(|_| {})).unwrap();
        let exit = futures::executor::block_on(host.wait_for_terminal_exit(&id).unwrap()).unwrap();
        assert_eq!(exit.code, Some(3));
        let output = host.terminal_output(&id).unwrap();
        assert!(output.output.contains("hello"));
        assert!(output.output.contains("oops"));
        assert_eq!(output.exit_status.unwrap().exit_code, Some(3));
    }
}

/// Terminal output as plain text: colour and cursor escapes dropped, and a line rewritten with
/// carriage returns (a progress bar) kept only as it ended. Ported from Athas's
/// `lib/acp-terminal-output.ts` (`formatAcpTerminalText`).
pub fn plain_terminal_text(output: &str) -> String {
    let mut stripped = String::with_capacity(output.len());
    let mut chars = output.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '\u{1b}' {
            stripped.push(c);
            continue;
        }
        match chars.peek().copied() {
            // OSC: up to BEL or ESC \.
            Some(']') => {
                chars.next();
                while let Some(c) = chars.next() {
                    if c == '\u{7}' {
                        break;
                    }
                    if c == '\u{1b}' {
                        if chars.peek() == Some(&'\\') {
                            chars.next();
                        }
                        break;
                    }
                }
            }
            // CSI: parameters, intermediates, then a final byte.
            Some('[') => {
                chars.next();
                while let Some(&c) = chars.peek() {
                    chars.next();
                    if ('@'..='~').contains(&c) && !('0'..='?').contains(&c) && !(' '..='/').contains(&c) {
                        break;
                    }
                }
            }
            Some(c) if ('@'..='Z').contains(&c) || ('\\'..='_').contains(&c) => {
                chars.next();
            }
            _ => {}
        }
    }
    stripped
        .replace("\r\n", "\n")
        .split('\n')
        .map(|line| line.split('\r').filter(|part| !part.is_empty()).last().unwrap_or_default())
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod plain_text_tests {
    #[test]
    fn escapes_and_progress_rewrites_are_dropped() {
        let output = "\u{1b}]0;title\u{7}\u{1b}[1;32mok\u{1b}[0m\r\nloading 10%\rloading 100%\r\ndone\u{1b}M";
        assert_eq!(super::plain_terminal_text(output), "ok\nloading 100%\ndone");
    }
}
