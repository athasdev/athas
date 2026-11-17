//! Runs an agent as a child process and connects its stdio to a [`Transport`]. The pipes are read
//! and written on plain threads, so the connection works on any executor.

use std::{
    collections::VecDeque,
    io::Write,
    path::Path,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    time::Duration,
};

use anyhow::{Context as _, Result};
use futures::channel::mpsc;

use super::{
    agents::AgentCommand,
    rpc::Transport,
    traffic::{Direction, Tap},
};

const STDERR_LINES: usize = 40;

/// A running agent process. Dropping it stops the agent and everything it started.
pub struct AgentProcess {
    child: Arc<Mutex<Child>>,
    stderr: Arc<Mutex<VecDeque<String>>>,
    _tap: Option<Arc<Tap>>,
}

impl AgentProcess {
    pub fn spawn(command: &AgentCommand, cwd: &Path) -> Result<(Self, Transport)> {
        Self::spawn_recorded(command, cwd, None)
    }

    /// Spawns the agent with its stdio recorded for the ACP inspector.
    pub fn spawn_recorded(command: &AgentCommand, cwd: &Path, tap: Option<Arc<Tap>>) -> Result<(Self, Transport)> {
        let mut cmd = Command::new(&command.program);
        cmd.args(&command.args)
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let path = super::agents::search_path();
        if let Ok(joined) = std::env::join_paths(path) {
            cmd.env("PATH", joined);
        }
        for (key, value) in &command.env {
            cmd.env(key, value);
        }
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            // Its own process group, so stopping the agent also stops the tools it runs.
            cmd.process_group(0);
        }
        let mut child = cmd.spawn().with_context(|| format!("Could not start {}", command.program.display()))?;

        let (to_agent_tx, to_agent_rx) = mpsc::unbounded::<String>();
        let (from_agent_tx, from_agent_rx) = mpsc::unbounded::<String>();
        let mut stdin = child.stdin.take().context("agent stdin")?;
        let stdout = child.stdout.take().context("agent stdout")?;
        let stderr_pipe = child.stderr.take().context("agent stderr")?;

        let stdin_tap = tap.clone();
        std::thread::Builder::new().name("acp-agent-stdin".into()).spawn(move || {
            let mut lines = futures::executor::block_on_stream(to_agent_rx);
            for line in lines.by_ref() {
                if let Some(tap) = &stdin_tap {
                    tap.record(Direction::Out, &line);
                }
                if stdin.write_all(line.as_bytes()).and_then(|_| stdin.write_all(b"\n")).and_then(|_| stdin.flush()).is_err() {
                    break;
                }
            }
        })?;
        let stdout_tap = tap.clone();
        std::thread::Builder::new().name("acp-agent-stdout".into()).spawn(move || {
            for line in lossy_lines(stdout) {
                if let Some(tap) = &stdout_tap {
                    tap.record(Direction::In, &line);
                }
                if from_agent_tx.unbounded_send(line).is_err() {
                    break;
                }
            }
        })?;
        let stderr: Arc<Mutex<VecDeque<String>>> = Arc::default();
        let stderr_lines = stderr.clone();
        let stderr_tap = tap.clone();
        std::thread::Builder::new().name("acp-agent-stderr".into()).spawn(move || {
            for line in lossy_lines(stderr_pipe) {
                if let Some(tap) = &stderr_tap {
                    tap.record(Direction::Stderr, &line);
                }
                let mut lines = stderr_lines.lock().unwrap_or_else(|p| p.into_inner());
                lines.push_back(line);
                if lines.len() > STDERR_LINES {
                    lines.pop_front();
                }
            }
        })?;

        Ok((Self { child: Arc::new(Mutex::new(child)), stderr, _tap: tap }, Transport { outgoing: to_agent_tx, incoming: from_agent_rx }))
    }

    /// The line of the agent's recent stderr most likely to explain a failure.
    pub fn stderr_hint(&self) -> Option<String> {
        let lines = self.stderr.lock().unwrap_or_else(|p| p.into_inner());
        relevant_stderr(lines.iter().map(String::as_str))
    }

    fn stop(&self) {
        let child = self.child.clone();
        // Ask nicely, then insist: agents get a moment to save their session.
        #[cfg(unix)]
        {
            let pid = child.lock().unwrap_or_else(|p| p.into_inner()).id();
            signal_group(pid, libc::SIGTERM);
        }
        std::thread::spawn(move || {
            for _ in 0..20 {
                if matches!(child.lock().unwrap_or_else(|p| p.into_inner()).try_wait(), Ok(Some(_))) {
                    return;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            let mut child = child.lock().unwrap_or_else(|p| p.into_inner());
            #[cfg(unix)]
            signal_group(child.id(), libc::SIGKILL);
            let _ = child.kill();
            let _ = child.wait();
        });
    }
}

impl Drop for AgentProcess {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(unix)]
pub(crate) fn signal_group(pid: u32, signal: libc::c_int) {
    if pid == 0 || pid > libc::pid_t::MAX as u32 {
        return;
    }
    // The child leads its own process group (`process_group(0)`), so its group id is its pid.
    unsafe {
        libc::kill(-(pid as libc::pid_t), signal);
    }
}

/// Picks the stderr line that says what went wrong: an authentication or error line, else the
/// last one. Ported from `relevant_agent_stderr` in `crates/ai/src/acp/bridge_init.rs`.
pub fn relevant_stderr<'a>(lines: impl DoubleEndedIterator<Item = &'a str> + Clone) -> Option<String> {
    let line = lines
        .clone()
        .rev()
        .find(|line| {
            let lower = line.to_lowercase();
            lower.contains("authentication failed") || lower.contains("requires setting") || lower.contains("error:")
        })
        .or_else(|| lines.rev().find(|line| !line.trim().is_empty()))?;
    let normalized = line.split_whitespace().collect::<Vec<_>>().join(" ");
    (!normalized.is_empty()).then_some(normalized)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_error_lines_from_stderr() {
        let lines = ["starting", "Error: requires   setting ANTHROPIC_API_KEY", "bye"];
        assert_eq!(relevant_stderr(lines.iter().copied()).as_deref(), Some("Error: requires setting ANTHROPIC_API_KEY"));
        assert_eq!(relevant_stderr(["one", "two", ""].iter().copied()).as_deref(), Some("two"));
        assert_eq!(relevant_stderr(std::iter::empty()), None);
    }

    #[cfg(unix)]
    #[test]
    fn talks_to_a_child_process_over_stdio() {
        use futures::StreamExt;
        let dir = tempfile::tempdir().unwrap();
        let command = AgentCommand { program: "/bin/cat".into(), args: Vec::new(), env: Vec::new() };
        let (process, mut transport) = AgentProcess::spawn(&command, dir.path()).unwrap();
        transport.outgoing.unbounded_send("{\"hello\":1}".into()).unwrap();
        let echoed = futures::executor::block_on(transport.incoming.next()).unwrap();
        assert_eq!(echoed, "{\"hello\":1}");
        drop(process);
    }
}

/// The lines `reader` gives, decoded lossily: a byte that is not UTF-8 (a log line in another
/// encoding) becomes U+FFFD instead of ending the read. `BufRead::lines` stops there, and a
/// stderr nobody drains makes the process block once its pipe is full.
fn lossy_lines(reader: impl std::io::Read) -> impl Iterator<Item = String> {
    use std::io::BufRead as _;
    let mut reader = std::io::BufReader::new(reader);
    std::iter::from_fn(move || {
        let mut bytes = Vec::new();
        match reader.read_until(b'\n', &mut bytes) {
            Ok(0) | Err(_) => None,
            Ok(_) => {
                while bytes.last().is_some_and(|byte| *byte == b'\n' || *byte == b'\r') {
                    bytes.pop();
                }
                Some(String::from_utf8_lossy(&bytes).into_owned())
            }
        }
    })
}
