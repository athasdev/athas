//! Docker on this machine behind [`Provider`]: a container per sandbox, reached with the `docker`
//! command rather than the daemon's socket. The socket would mean a second HTTP client and a
//! platform's worth of ways to find it (a Unix path here, a named pipe there, a TCP host under
//! Colima); the command is the one thing every install has, and it is what the user would type.
//!
//! The container is the odd one out among the providers: nothing is paid for, nothing expires,
//! and there is no key. What it costs instead is an image with the tools the workspace sync
//! needs -- `bash`, `tar`, `gzip` and `git` -- which is why the default is a dev container image
//! and not `alpine`.

use std::{
    io::{Read, Write},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

use serde_json::Value;

use crate::{Error, Exec, Listed, Output, Provider, Result, Sandbox, Spec};

pub const ID: &str = "docker";
/// Where a sandbox's workspace goes. Not a home directory: the container runs as root, and
/// `/workspace` says what it is without pretending to be someone's account.
pub const ROOT: &str = "/workspace";
/// The image a container is made from when the caller names none. It carries `git`, `tar` and
/// `gzip`, which the workspace sync needs and a bare `ubuntu` does not.
const DEFAULT_IMAGE: &str = "mcr.microsoft.com/devcontainers/base:ubuntu";
/// The label every container Athas made carries, so listing finds those and not the user's own.
const LABEL: &str = "dev.athas.sandbox";
/// Overrides the command, for Podman or a `docker` somewhere unusual.
const BINARY_VAR: &str = "ATHAS_DOCKER";
/// Starting a container can mean pulling an image, which is gigabytes over someone's broadband.
const CREATE_TIMEOUT: Duration = Duration::from_secs(10 * 60);
/// Everything else is local and immediate; a minute is already a hung daemon.
const QUICK_TIMEOUT: Duration = Duration::from_secs(60);
const TRANSFER_TIMEOUT: Duration = Duration::from_secs(5 * 60);

pub struct Docker {
    binary: String,
}

impl Default for Docker {
    fn default() -> Self {
        Self::new()
    }
}

impl Docker {
    pub fn new() -> Self {
        Self { binary: std::env::var(BINARY_VAR).unwrap_or_else(|_| "docker".into()) }
    }

    /// Points at another command, for Podman and for the tests.
    pub fn with_binary(binary: impl Into<String>) -> Self {
        Self { binary: binary.into() }
    }

    /// Runs the command and insists it succeeded, with its stderr as the message.
    fn ok(&self, args: &[&str], what: &str, timeout: Duration) -> Result<String> {
        let finished = self.spawn(args, None, timeout, what)?;
        if finished.timed_out {
            return Err(Error::unavailable(format!("{what}: Docker did not answer in time.")));
        }
        if finished.code != 0 {
            return Err(refused(&finished.stderr_text(), what));
        }
        Ok(String::from_utf8_lossy(&finished.stdout).into_owned())
    }

    /// Spawns the command, feeds it `stdin` and reads both its streams at once. Reading one to
    /// the end first is what deadlocks a `docker exec` whose other stream fills its pipe.
    fn spawn(&self, args: &[&str], stdin: Option<&[u8]>, timeout: Duration, what: &str) -> Result<Finished> {
        let mut child = Command::new(&self.binary)
            .args(args)
            .stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| match error.kind() {
                std::io::ErrorKind::NotFound => {
                    Error::auth(format!("{what}: Docker is not installed, or `{}` is not on the PATH.", self.binary))
                }
                _ => Error::unavailable(format!("{what}: Docker could not be started ({error}).")),
            })?;
        if let (Some(mut pipe), Some(bytes)) = (child.stdin.take(), stdin) {
            let bytes = bytes.to_vec();
            // Written on a thread of its own: a large file fills the pipe long before the
            // command has read any of it, and writing it here would wait for a reader that is
            // this same thread.
            std::thread::spawn(move || {
                let _ = pipe.write_all(&bytes);
                let _ = pipe.flush();
            });
        }
        let out = reader(child.stdout.take());
        let err = reader(child.stderr.take());
        let started = Instant::now();
        let mut timed_out = false;
        let code = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status.code().unwrap_or(-1),
                Ok(None) => {}
                Err(error) => return Err(Error::unavailable(format!("{what}: Docker could not be waited on ({error})."))),
            }
            if started.elapsed() > timeout {
                let _ = child.kill();
                let _ = child.wait();
                timed_out = true;
                break -1;
            }
            std::thread::sleep(Duration::from_millis(15));
        };
        let stdout = out.join().unwrap_or_default();
        let stderr = err.join().unwrap_or_default();
        Ok(Finished { code, stdout, stderr, timed_out })
    }

    /// The container id of a sandbox, which is all Docker needs to be told.
    fn container(sandbox: &Sandbox) -> &str {
        &sandbox.id
    }

    /// The shell every command goes through, so `&&`, pipes and globs mean what they do in a
    /// terminal. `-l` so a login shell's PATH is the one a user would get.
    fn shell(command: &str) -> [&str; 3] {
        ["/bin/bash", "-lc", command]
    }
}

struct Finished {
    code: i32,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    timed_out: bool,
}

impl Finished {
    fn stderr_text(&self) -> String {
        String::from_utf8_lossy(&self.stderr).trim().to_string()
    }
}

fn reader(pipe: Option<impl Read + Send + 'static>) -> std::thread::JoinHandle<Vec<u8>> {
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        if let Some(mut pipe) = pipe {
            let _ = pipe.read_to_end(&mut bytes);
        }
        bytes
    })
}

/// Docker's refusals, in the four shapes a caller acts on. The daemon not running is the one
/// worth naming: it is what is wrong nine times out of ten, and it is the user's to fix.
fn refused(stderr: &str, what: &str) -> Error {
    let lower = stderr.to_lowercase();
    if lower.contains("cannot connect to the docker daemon") || lower.contains("is the docker daemon running") {
        return Error::auth(format!("{what}: Docker is not running. Start Docker Desktop (or your daemon) and try again."));
    }
    if lower.contains("no such container") || lower.contains("is not running") {
        return Error::gone(format!("{what}: the container is gone. It was removed or stopped."));
    }
    let detail = stderr.lines().last().unwrap_or("").trim();
    match detail.is_empty() {
        true => Error::unavailable(format!("{what}: Docker refused without saying why.")),
        false => Error::unavailable(format!("{what}: {detail}")),
    }
}

impl Provider for Docker {
    fn id(&self) -> &str {
        ID
    }

    fn list(&self) -> Result<Vec<Listed>> {
        let filter = format!("label={LABEL}");
        let listed = self.ok(&["ps", "--all", "--filter", &filter, "--format", "{{json .}}"], "Listing the containers", QUICK_TIMEOUT)?;
        Ok(listed
            .lines()
            .filter_map(|line| serde_json::from_str::<Value>(line).ok())
            .filter_map(|entry| {
                Some(Listed {
                    id: entry.get("ID")?.as_str()?.to_string(),
                    template: entry.get("Image").and_then(Value::as_str).unwrap_or_default().to_string(),
                    state: entry.get("State").and_then(Value::as_str).unwrap_or("running").to_string(),
                    started_at: entry.get("CreatedAt").and_then(Value::as_str).map(str::to_string),
                    // A container has no end of its own and no quota to report, which is most of
                    // the reason to run one.
                    ends_at: None,
                    cpus: 0,
                    memory_mb: 0,
                })
            })
            .collect())
    }

    fn create(&self, spec: &Spec) -> Result<Sandbox> {
        let image = spec.template.clone().unwrap_or_else(|| DEFAULT_IMAGE.into());
        let label = format!("{LABEL}=1");
        let mut args: Vec<String> = vec![
            "run".into(),
            "--detach".into(),
            "--label".into(),
            label,
            "--workdir".into(),
            ROOT.into(),
            // Root, so a workspace copied in is writable whatever the image's own user is.
            "--user".into(),
            "root".into(),
        ];
        for (name, value) in &spec.metadata {
            args.push("--label".into());
            args.push(format!("{LABEL}.{name}={value}"));
        }
        for (name, value) in &spec.env {
            args.push("--env".into());
            args.push(format!("{name}={value}"));
        }
        args.push(image.clone());
        // Something that never exits: the container is a place to run commands, not a command.
        args.extend(["sleep".to_string(), "infinity".to_string()]);
        let borrowed: Vec<&str> = args.iter().map(String::as_str).collect();
        let id = self
            .ok(&borrowed, "Starting a container", CREATE_TIMEOUT)
            .map_err(|error| match error.message.contains("manifest unknown") || error.message.contains("not found") {
                true => Error::unavailable(format!("Starting a container: Docker has no image named {image}.")),
                false => error,
            })?
            .trim()
            .to_string();
        if id.is_empty() {
            return Err(Error::protocol("Docker started a container without telling us its id."));
        }
        Ok(Sandbox { provider: ID.into(), id, host: String::new(), access_token: None, root: ROOT.into() })
    }

    fn attach(&self, id: &str) -> Result<Sandbox> {
        let running = self.ok(&["inspect", "--format", "{{.State.Running}}", id], "Opening the container", QUICK_TIMEOUT)?;
        // A stopped container is not gone: it is started again, with everything in it where it
        // was left. That is the whole of what a local sandbox is for.
        if running.trim() != "true" {
            self.ok(&["start", id], "Starting the container", QUICK_TIMEOUT)?;
        }
        let root = self
            .ok(&["inspect", "--format", "{{.Config.WorkingDir}}", id], "Opening the container", QUICK_TIMEOUT)
            .map(|dir| dir.trim().to_string())
            .unwrap_or_default();
        let root = if root.is_empty() { ROOT.to_string() } else { root };
        Ok(Sandbox { provider: ID.into(), id: id.to_string(), host: String::new(), access_token: None, root })
    }

    fn exec(&self, sandbox: &Sandbox, exec: &Exec) -> Result<Output> {
        let mut args: Vec<String> = vec!["exec".into()];
        if let Some(cwd) = &exec.cwd {
            args.push("--workdir".into());
            args.push(cwd.clone());
        }
        for (name, value) in &exec.env {
            args.push("--env".into());
            args.push(format!("{name}={value}"));
        }
        args.push(Self::container(sandbox).to_string());
        args.extend(Self::shell(&exec.command).map(str::to_string));
        let borrowed: Vec<&str> = args.iter().map(String::as_str).collect();
        let finished = self.spawn(&borrowed, None, exec.timeout, "Running a command")?;
        if finished.timed_out {
            return Ok(Output { exit_code: None, stdout: String::new(), stderr: String::new(), timed_out: true });
        }
        // A container that went away while the command ran is a different failure from a command
        // that returned non-zero, and only the first is worth an error.
        let stderr = String::from_utf8_lossy(&finished.stderr).into_owned();
        if finished.code != 0 && stderr.to_lowercase().contains("no such container") {
            return Err(refused(&stderr, "Running a command"));
        }
        Ok(Output { exit_code: Some(finished.code), stdout: String::from_utf8_lossy(&finished.stdout).into_owned(), stderr, timed_out: false })
    }

    fn write_file(&self, sandbox: &Sandbox, path: &str, bytes: &[u8]) -> Result<()> {
        // `docker cp` would need a tar on this side for one file. The shell already has a way to
        // take bytes on stdin, and the parent directory is made in the same breath.
        let command = format!("mkdir -p \"$(dirname {quoted})\" && cat > {quoted}", quoted = quote(path));
        let container = Self::container(sandbox).to_string();
        let shell = Self::shell(&command);
        let args = ["exec", "--interactive", &container, shell[0], shell[1], shell[2]];
        let finished = self.spawn(&args, Some(bytes), TRANSFER_TIMEOUT, &format!("Writing {path}"))?;
        if finished.timed_out {
            return Err(Error::unavailable(format!("Writing {path}: the container did not take it in time.")));
        }
        match finished.code {
            0 => Ok(()),
            _ => Err(refused(&finished.stderr_text(), &format!("Writing {path}"))),
        }
    }

    fn read_file(&self, sandbox: &Sandbox, path: &str) -> Result<Vec<u8>> {
        let command = format!("cat {}", quote(path));
        let container = Self::container(sandbox).to_string();
        let shell = Self::shell(&command);
        let args = ["exec", &container, shell[0], shell[1], shell[2]];
        let what = format!("Reading {path}");
        let finished = self.spawn(&args, None, TRANSFER_TIMEOUT, &what)?;
        if finished.timed_out {
            return Err(Error::unavailable(format!("{what}: the container did not answer in time.")));
        }
        match finished.code {
            0 => Ok(finished.stdout),
            _ => Err(refused(&finished.stderr_text(), &what)),
        }
    }

    fn keep_alive(&self, _sandbox: &Sandbox, _seconds: u32) -> Result<()> {
        // A container has no lease to extend: it runs until it is stopped. Nothing to do is the
        // right answer here, not an error.
        Ok(())
    }

    fn dispose(&self, sandbox: &Sandbox) -> Result<()> {
        match self.ok(&["rm", "--force", Self::container(sandbox)], "Stopping the container", QUICK_TIMEOUT) {
            Err(error) if error.kind == crate::ErrorKind::Gone => Ok(()),
            Err(error) => Err(error),
            Ok(_) => Ok(()),
        }
    }
}

/// A path the shell reads as one word, however it is spelled.
fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', r"'\''"))
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_path_with_a_quote_in_it_is_still_one_word() {
        assert_eq!(super::quote("/workspace/it's here.txt"), r"'/workspace/it'\''s here.txt'");
        assert_eq!(super::quote("/workspace/a b"), "'/workspace/a b'");
    }

    #[test]
    fn a_daemon_that_is_not_running_is_the_users_to_fix_and_not_worth_retrying() {
        let error = super::refused("Cannot connect to the Docker daemon at unix:///var/run/docker.sock.", "Listing the containers");
        assert_eq!(error.kind, crate::ErrorKind::Auth);
        assert!(!error.is_retryable());
        assert!(error.message.contains("Start Docker Desktop"), "{}", error.message);
    }

    #[test]
    fn a_container_that_is_gone_says_so() {
        let error = super::refused("Error: No such container: abc123", "Running a command");
        assert_eq!(error.kind, crate::ErrorKind::Gone);
    }
}
