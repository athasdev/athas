//! A command the user runs from the composer by starting the message with `!`: it runs in the
//! session's folder and its output streams into the transcript, without going to the agent.
//!
//! Ported from Athas's `services/chat-terminal-command.ts`, `utils/composer-terminal-command.ts`
//! and `crates/ai/src/workspace_command.rs`.

#[cfg(not(target_family = "wasm"))]
use std::io::Read;
use std::{
    path::Path,
    sync::{Arc, Mutex},
};

/// Output kept from one command; the start is dropped past this.
#[cfg_attr(target_family = "wasm", allow(dead_code))]
const MAX_OUTPUT_BYTES: usize = 256 * 1024;

/// The command in a composer message that starts with `!`, or `None` for an ordinary message.
pub fn composer_command(input: &str) -> Option<&str> {
    input.trim_start().strip_prefix('!').map(str::trim)
}

/// The command of a message that asks to open it in a terminal ("open bun dev in terminal"),
/// which Athas does itself instead of asking the agent (`acp-ui-intents.ts`).
pub fn direct_terminal_intent(message: &str) -> Option<String> {
    let lower = message.trim().to_ascii_lowercase();
    let start = lower.find("open ").filter(|at| *at == 0 || !lower[..*at].ends_with(|ch: char| ch.is_alphanumeric()))?;
    let after = &lower[start + 5..];
    let end = [" in terminal", " on terminal"].iter().filter_map(|marker| after.find(marker).filter(|at| after[at + marker.len()..].chars().next().is_none_or(|ch| !ch.is_alphanumeric()))).min()?;
    let original = &message.trim()[start + 5..start + 5 + end];
    let leading: &[char] = &['`', '"', '\'', '(', '[', '{', '<'];
    let trailing: &[char] = &['`', '"', '\'', ')', ']', '}', '>', '.', ',', '!', '?', ';', ':'];
    let command = original.trim().trim_start_matches(leading).trim_end_matches(trailing).trim();
    (!command.is_empty()).then(|| command.to_string())
}

#[derive(Default)]
struct State {
    output: String,
    exit: Option<Option<i32>>,
}

/// How long a command may run before it is stopped (`run_workspace_command_with_output`).
pub const TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);

/// How long a stopped command gets to exit on SIGTERM before its group is killed.
#[cfg_attr(not(unix), allow(dead_code))]
const STOP_GRACE: std::time::Duration = std::time::Duration::from_secs(2);

/// A running (or finished) command.
pub struct UserCommand {
    state: Arc<Mutex<State>>,
    #[cfg(unix)]
    pid: Option<u32>,
    started: web_time::Instant,
    /// When Stop was pressed; the row reads "Stopping…" until the command ends.
    stop_requested: std::cell::Cell<Option<web_time::Instant>>,
    timed_out: std::cell::Cell<bool>,
}

impl UserCommand {
    #[cfg(not(target_family = "wasm"))]
    pub fn start(command: &str, cwd: &Path) -> Result<Self, String> {
        use std::process::{Command, Stdio};
        let shell = std::env::var("SHELL").ok().filter(|shell| !shell.is_empty()).unwrap_or_else(|| "/bin/sh".into());
        let mut process = if cfg!(windows) {
            let mut process = Command::new("cmd");
            process.args(["/C", command]);
            process
        } else {
            let mut process = Command::new(shell);
            process.args(["-lc", command]);
            process
        };
        process.current_dir(cwd).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt as _;
            process.process_group(0);
        }
        let mut child = process.spawn().map_err(|error| format!("Could not run the command: {error}"))?;
        let state = Arc::new(Mutex::new(State::default()));
        let readers: Vec<_> = [child.stdout.take().map(|out| Box::new(out) as Box<dyn Read + Send>), child.stderr.take().map(|err| Box::new(err) as Box<dyn Read + Send>)]
            .into_iter()
            .flatten()
            .map(|mut reader| {
                let state = state.clone();
                std::thread::spawn(move || {
                    let mut buffer = [0u8; 8192];
                    while let Ok(read) = reader.read(&mut buffer) {
                        if read == 0 {
                            break;
                        }
                        let mut state = state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
                        state.output.push_str(&String::from_utf8_lossy(&buffer[..read]));
                        if state.output.len() > MAX_OUTPUT_BYTES {
                            let cut = state.output.len() - MAX_OUTPUT_BYTES;
                            let cut = state.output.ceil_char_boundary(cut);
                            state.output.drain(..cut);
                        }
                    }
                })
            })
            .collect();
        #[cfg(unix)]
        let pid = Some(child.id());
        let waiter = state.clone();
        std::thread::spawn(move || {
            let status = child.wait().ok();
            for reader in readers {
                let _ = reader.join();
            }
            waiter.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).exit = Some(status.and_then(|status| status.code()));
        });
        Ok(Self {
            state,
            #[cfg(unix)]
            pid,
            started: web_time::Instant::now(),
            stop_requested: std::cell::Cell::new(None),
            timed_out: std::cell::Cell::new(false),
        })
    }

    #[cfg(target_family = "wasm")]
    pub fn start(_: &str, _: &Path) -> Result<Self, String> {
        Err("Inline commands need a local workspace. Use the terminal for this project.".into())
    }

    /// The output so far, and the exit code once it finished (`Some(None)` when it was killed).
    pub fn snapshot(&self) -> (String, Option<Option<i32>>) {
        let state = self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        (state.output.clone(), state.exit)
    }

    /// Asks the command to stop (SIGTERM to its group); `tick` kills it if it does not.
    pub fn stop(&self) {
        if self.snapshot().1.is_some() {
            return;
        }
        if self.stop_requested.get().is_none() {
            self.stop_requested.set(Some(web_time::Instant::now()));
        }
        self.signal(false);
    }

    /// Whether Stop was pressed (or the time ran out) and the command has not ended yet.
    pub fn is_stopping(&self) -> bool {
        self.stop_requested.get().is_some() || self.timed_out.get()
    }

    /// Whether the user stopped it, as opposed to the timeout.
    pub fn was_stopped(&self) -> bool {
        self.stop_requested.get().is_some() && !self.timed_out.get()
    }

    pub fn timed_out(&self) -> bool {
        self.timed_out.get()
    }

    /// Enforces the 60 s limit and the grace a stopped command gets; called while it runs.
    pub fn tick(&self) {
        self.tick_at(web_time::Instant::now());
    }

    fn tick_at(&self, now: web_time::Instant) {
        if self.snapshot().1.is_some() {
            return;
        }
        if !self.timed_out.get() && self.stop_requested.get().is_none() && now.duration_since(self.started) >= TIMEOUT {
            // The original kills the group at once when the time is up.
            self.timed_out.set(true);
            self.signal(true);
        } else if let Some(requested) = self.stop_requested.get()
            && now.duration_since(requested) >= STOP_GRACE
        {
            self.signal(true);
        }
    }

    fn signal(&self, kill: bool) {
        #[cfg(unix)]
        if let Some(pid) = self.pid {
            crate::acp::process::signal_group(pid, if kill { libc::SIGKILL } else { libc::SIGTERM });
        }
        #[cfg(not(unix))]
        let _ = kill;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bang_messages_are_commands() {
        assert_eq!(composer_command("  ! ls -la "), Some("ls -la"));
        assert_eq!(composer_command("list files"), None);
    }

    #[cfg(unix)]
    #[test]
    fn output_and_exit_code_are_collected() {
        let dir = tempfile::tempdir().unwrap();
        let command = UserCommand::start("echo hi; echo oops >&2; exit 3", dir.path()).unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while command.snapshot().1.is_none() && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        let (output, exit) = command.snapshot();
        assert!(output.contains("hi") && output.contains("oops"));
        assert_eq!(exit, Some(Some(3)));
    }

    #[cfg(unix)]
    #[test]
    fn a_command_past_the_limit_is_killed_and_marked_timed_out() {
        let dir = tempfile::tempdir().unwrap();
        let command = UserCommand::start("sleep 30 & wait", dir.path()).unwrap();
        command.tick();
        assert!(!command.timed_out() && !command.is_stopping());
        command.tick_at(command.started + TIMEOUT);
        assert!(command.timed_out() && command.is_stopping() && !command.was_stopped());
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while command.snapshot().1.is_none() && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        assert_eq!(command.snapshot().1, Some(None));
    }

    #[cfg(unix)]
    #[test]
    fn stop_reads_stopping_until_the_command_ends() {
        let dir = tempfile::tempdir().unwrap();
        let command = UserCommand::start("trap '' TERM; sleep 30", dir.path()).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(100));
        command.stop();
        assert!(command.is_stopping() && command.was_stopped());
        command.tick_at(web_time::Instant::now() + STOP_GRACE);
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while command.snapshot().1.is_none() && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        assert!(command.snapshot().1.is_some());
        assert!(!command.timed_out());
    }

    #[test]
    fn reads_open_in_terminal_requests() {
        assert_eq!(direct_terminal_intent("open `bun dev` in terminal").as_deref(), Some("bun dev"));
        assert_eq!(direct_terminal_intent("Please open htop on terminal.").as_deref(), Some("htop"));
        assert_eq!(direct_terminal_intent("reopen the file"), None);
        assert_eq!(direct_terminal_intent("open the settings"), None);
    }
}
