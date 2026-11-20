//! The process side of a terminal, kept behind a small interface: bytes in, bytes out, a size and
//! an exit. The local backend runs a shell on a native PTY; a remote backend (a PTY streamed from a
//! server to the web build) only has to implement [`Pty`] and drive a [`PtyIo`].

use std::sync::mpsc::Receiver;

use anyhow::Result;

use crate::shell::ShellCommand;

/// A terminal grid's size, in cells and pixels.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PtySize {
    pub rows: u16,
    pub cols: u16,
    pub cell_width: u16,
    pub cell_height: u16,
}

/// How a backend talks to the terminal: it writes what arrives on `input` to the process, hands
/// what the process prints to `output`, and calls `exited` once the process is gone.
pub struct PtyIo {
    pub input: Receiver<Vec<u8>>,
    pub output: Box<dyn FnMut(&[u8]) + Send>,
    pub exited: Box<dyn FnOnce(ExitStatus) + Send>,
}

/// How the process ended, when the backend knows.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ExitStatus {
    pub code: Option<i32>,
    pub signal: Option<String>,
}

impl ExitStatus {
    /// Whether the terminal can close: a zero code, or nothing known.
    pub fn is_clean(&self) -> bool {
        self.signal.is_none() && self.code.is_none_or(|code| code == 0)
    }

    /// The line a terminal that ended otherwise shows (`use-terminal-connection.ts`).
    pub fn describe(&self) -> String {
        let details = match (&self.signal, self.code) {
            (Some(signal), _) => format!("signal {signal}"),
            (None, Some(code)) => format!("exit code {code}"),
            (None, None) => "unknown status".to_string(),
        };
        format!("Terminal process exited unexpectedly ({details}).")
    }
}

/// A running process on a PTY. Dropping it hangs the process up.
pub trait Pty: Send {
    fn resize(&self, size: PtySize);
    /// The program in the foreground (`vim`, `npm`), or the shell when it is idle.
    fn foreground_process_name(&self) -> Option<String>;
}

#[cfg(not(target_family = "wasm"))]
pub(crate) fn spawn(command: &ShellCommand, size: PtySize, io: PtyIo) -> Result<Box<dyn Pty>> {
    Ok(Box::new(local::LocalPty::spawn(command, size, io)?))
}

#[cfg(target_family = "wasm")]
pub(crate) fn spawn(_: &ShellCommand, _: PtySize, _: PtyIo) -> Result<Box<dyn Pty>> {
    anyhow::bail!("terminals need a remote PTY in the browser")
}

#[cfg(not(target_family = "wasm"))]
mod local {
    use std::io::{Read, Write};

    use anyhow::{Context as _, Result};
    use portable_pty::{ChildKiller, CommandBuilder, MasterPty, native_pty_system};

    use super::{ExitStatus, Pty, PtyIo, PtySize};
    use crate::shell::ShellCommand;

    pub(super) struct LocalPty {
        master: Box<dyn MasterPty + Send>,
        killer: Box<dyn ChildKiller + Send + Sync>,
    }

    impl LocalPty {
        pub(super) fn spawn(command: &ShellCommand, size: PtySize, io: PtyIo) -> Result<Self> {
            let pair = native_pty_system().openpty(pty_size(size)).context("opening a PTY")?;

            let host;
            let command = if crate::flatpak::is_sandboxed() {
                host = crate::flatpak::on_host(command);
                &host
            } else {
                command
            };
            let mut builder = CommandBuilder::new(&command.program);
            builder.args(&command.args);
            builder.cwd(&command.cwd);
            for key in &command.env_remove {
                builder.env_remove(key);
            }
            for (key, value) in &command.env {
                builder.env(key, value);
            }
            let mut child = pair
                .slave
                .spawn_command(builder)
                .with_context(|| format!("starting {}", command.program))?;
            // Only the child keeps the PTY's other end open, so reading ends when it exits.
            drop(pair.slave);

            let killer = child.clone_killer();
            let mut reader = pair.master.try_clone_reader()?;
            let mut writer = pair.master.take_writer()?;
            let PtyIo { input, mut output, exited } = io;

            std::thread::Builder::new().name("terminal-reader".into()).spawn(move || {
                let mut buffer = vec![0; 64 * 1024];
                loop {
                    match reader.read(&mut buffer) {
                        Ok(0) => break,
                        Ok(read) => output(&buffer[..read]),
                        Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
                        Err(_) => break,
                    }
                }
                let status = child.wait().ok();
                exited(ExitStatus {
                    code: status.as_ref().map(|status| status.exit_code() as i32),
                    signal: status.as_ref().and_then(|status| status.signal()).map(str::to_string),
                });
            })?;

            std::thread::Builder::new().name("terminal-writer".into()).spawn(move || {
                for bytes in input {
                    if writer.write_all(&bytes).and_then(|_| writer.flush()).is_err() {
                        break;
                    }
                }
            })?;

            Ok(Self { master: pair.master, killer })
        }
    }

    impl Pty for LocalPty {
        fn resize(&self, size: PtySize) {
            self.master.resize(pty_size(size)).ok();
        }

        fn foreground_process_name(&self) -> Option<String> {
            #[cfg(unix)]
            {
                process_name(self.master.process_group_leader()?)
            }
            #[cfg(not(unix))]
            {
                None
            }
        }
    }

    impl Drop for LocalPty {
        fn drop(&mut self) {
            // SIGHUP, as closing a terminal window sends it; the shell passes it on to its jobs.
            self.killer.kill().ok();
        }
    }

    fn pty_size(size: PtySize) -> portable_pty::PtySize {
        portable_pty::PtySize {
            rows: size.rows,
            cols: size.cols,
            pixel_width: size.cols.saturating_mul(size.cell_width),
            pixel_height: size.rows.saturating_mul(size.cell_height),
        }
    }

    #[cfg(target_os = "macos")]
    fn process_name(pid: libc::pid_t) -> Option<String> {
        let mut buffer = [0u8; 256];
        let length = unsafe { libc::proc_name(pid, buffer.as_mut_ptr().cast(), buffer.len() as u32) };
        (length > 0).then(|| String::from_utf8_lossy(&buffer[..length as usize]).into_owned())
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    fn process_name(pid: libc::pid_t) -> Option<String> {
        let name = std::fs::read_to_string(format!("/proc/{pid}/comm")).ok()?;
        Some(name.trim_end().to_string()).filter(|name| !name.is_empty())
    }
}
