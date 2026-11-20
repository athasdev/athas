//! A terminal on the remote host: a login shell on an SSH channel with a PTY, on its own session so
//! a busy terminal never holds up file operations (`terminal.rs` in Athas). One thread owns the
//! channel: it writes input, applies resizes, and streams output until the shell exits or the
//! terminal is dropped. Ctrl-C and other signals travel as bytes through the PTY, as with `ssh`.

use std::{
    io::{ErrorKind, Read, Write},
    path::Path,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, Sender, TryRecvError},
    },
    time::Duration,
};

use anyhow::{Context as _, Result};

use crate::{fs::remote_path, manager::manager, path::shell_quote};

/// A terminal grid's size, in cells and pixels per cell (the terminal's `PtySize`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PtySize {
    pub rows: u16,
    pub cols: u16,
    pub cell_width: u16,
    pub cell_height: u16,
}

impl PtySize {
    fn dimensions(self) -> (u32, u32, u32, u32) {
        (
            self.cols as u32,
            self.rows as u32,
            self.cols.saturating_mul(self.cell_width) as u32,
            self.rows.saturating_mul(self.cell_height) as u32,
        )
    }
}

/// Receives what the shell prints.
pub type OutputCallback = Box<dyn FnMut(&[u8]) + Send>;

/// How the remote shell ended: the code and signal the server reported (`remote_exit_status`).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ExitStatus {
    pub code: Option<i32>,
    pub signal: Option<String>,
}

/// A running remote shell. Dropping it closes the channel, which hangs the shell up.
pub struct RemotePty {
    resize: Sender<PtySize>,
    stop: Arc<AtomicBool>,
}

const IDLE_WAIT: Duration = Duration::from_millis(8);
/// libssh2 reports a momentary "transport read" failure on busy links; that many in a row end the
/// terminal, as in the original.
const MAX_TRANSIENT_READ_FAILURES: u8 = 10;

/// A read error worth retrying (`is_transient_read_error`).
fn is_transient_read_error(kind: ErrorKind, message: &str) -> bool {
    matches!(kind, ErrorKind::WouldBlock | ErrorKind::Interrupted) || message.eq_ignore_ascii_case("transport read")
}

/// The command that starts the shell in `cwd`: `cd` first, then the user's login shell.
pub fn start_command(cwd: &str) -> String {
    format!("cd {} 2>/dev/null; exec \"${{SHELL:-/bin/sh}}\" -l", shell_quote(cwd))
}

impl RemotePty {
    /// Starts a shell in the folder `cwd` (a `remote://` path) and streams it: what arrives on
    /// `input` goes to the shell, what it prints goes to `output`, and `exited` runs once it ends.
    pub fn spawn(
        cwd: &Path,
        size: PtySize,
        input: Receiver<Vec<u8>>,
        mut output: OutputCallback,
        exited: Box<dyn FnOnce(ExitStatus) + Send>,
    ) -> Result<Self> {
        let cwd = remote_path(cwd)?;
        let connection = manager().get_or_connect(&cwd.connection_id)?;
        let (session, proxy) = connection.open_session()?;
        let mut channel = session.channel_session().context("Failed to open a terminal channel")?;
        for (name, value) in [("COLORTERM", "truecolor"), ("TERM_PROGRAM", "athas"), ("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"))] {
            // Servers only accept the variables their AcceptEnv lists.
            channel.setenv(name, value).ok();
        }
        channel.request_pty("xterm-256color", None, Some(size.dimensions())).context("Failed to request a PTY")?;
        channel.exec(&start_command(&cwd.path)).context("Failed to start the remote shell")?;

        let (resize, resizes) = mpsc::channel::<PtySize>();
        let stop = Arc::new(AtomicBool::new(false));
        let stopped = stop.clone();
        std::thread::Builder::new().name("remote-terminal".into()).spawn(move || {
            let _proxy = proxy;
            let mut buffer = vec![0; 64 * 1024];
            let mut transient_failures = 0u8;
            // The connection broke (a read or write failed) rather than the shell ending.
            let mut lost = false;
            session.set_blocking(false);
            'stream: while !stopped.load(Ordering::Relaxed) {
                let mut busy = false;
                while let Ok(size) = resizes.try_recv() {
                    let (cols, rows, width, height) = size.dimensions();
                    session.set_blocking(true);
                    channel.request_pty_size(cols, rows, Some(width), Some(height)).ok();
                    session.set_blocking(false);
                }
                loop {
                    match input.try_recv() {
                        Ok(bytes) => {
                            busy = true;
                            session.set_blocking(true);
                            let written = channel.write_all(&bytes).and_then(|_| channel.flush());
                            session.set_blocking(false);
                            if written.is_err() {
                                lost = true;
                                break 'stream;
                            }
                        }
                        Err(TryRecvError::Empty) => break,
                        Err(TryRecvError::Disconnected) => break 'stream,
                    }
                }
                match channel.read(&mut buffer) {
                    Ok(0) if channel.eof() => break,
                    Ok(0) => {}
                    Ok(read) => {
                        busy = true;
                        transient_failures = 0;
                        output(&buffer[..read]);
                    }
                    Err(error) if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::Interrupted) => {}
                    Err(error) if is_transient_read_error(error.kind(), &error.to_string()) && transient_failures < MAX_TRANSIENT_READ_FAILURES => {
                        transient_failures += 1;
                        std::thread::sleep(Duration::from_millis(25));
                    }
                    Err(_) => {
                        lost = true;
                        break;
                    }
                }
                if channel.eof() {
                    break;
                }
                if !busy {
                    std::thread::sleep(IDLE_WAIT);
                }
            }
            session.set_blocking(true);
            session.set_timeout(2_000);
            channel.close().ok();
            channel.wait_close().ok();
            // libssh2 reports exit status 0 when none arrived; after a lost connection that
            // would read as a clean exit and close the tab without a word.
            let status = if lost {
                ExitStatus { code: None, signal: Some("connection lost".into()) }
            } else {
                ExitStatus { code: channel.exit_status().ok(), signal: channel.exit_signal().ok().and_then(|signal| signal.exit_signal) }
            };
            session.disconnect(None, "Terminal closed", None).ok();
            exited(status);
        })?;
        Ok(Self { resize, stop })
    }

    pub fn resize(&self, size: PtySize) {
        self.resize.send(size).ok();
    }

    /// The remote foreground program is not visible over SSH; tabs show the shell's title instead.
    pub fn foreground_process_name(&self) -> Option<String> {
        None
    }
}

impl Drop for RemotePty {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retries_non_blocking_and_transport_read_errors() {
        assert!(is_transient_read_error(ErrorKind::WouldBlock, "operation would block"));
        assert!(is_transient_read_error(ErrorKind::Other, "transport read"));
        assert!(!is_transient_read_error(ErrorKind::ConnectionReset, "connection reset"));
    }

    #[test]
    fn starts_a_login_shell_in_the_folder() {
        assert_eq!(start_command("/srv/my app"), "cd '/srv/my app' 2>/dev/null; exec \"${SHELL:-/bin/sh}\" -l");
        let size = PtySize { rows: 24, cols: 80, cell_width: 8, cell_height: 16 };
        assert_eq!(size.dimensions(), (80, 24, 640, 384));
    }

    #[cfg(unix)]
    #[test]
    fn start_command_runs_in_a_posix_shell() {
        let dir = tempfile::tempdir().unwrap();
        let output = std::process::Command::new("sh")
            .arg("-c")
            .arg(start_command(&dir.path().to_string_lossy()).replace("exec \"${SHELL:-/bin/sh}\" -l", "pwd"))
            .output()
            .unwrap();
        let printed = String::from_utf8(output.stdout).unwrap();
        assert!(printed.trim().ends_with(dir.path().file_name().unwrap().to_str().unwrap()));
    }
}
