//! A saved SSH connection as a sandbox: the user's own machine, running the session's commands.
//!
//! It is the same shape as a hosted sandbox and one promise short of one. A sandbox is made,
//! leased and thrown away; a machine is none of those. So [`Provider::create`] connects rather
//! than provisions, [`Provider::keep_alive`] does nothing, and -- the one that matters --
//! [`Provider::dispose`] does nothing at all. Athas does not get to turn off the user's computer.
//!
//! Commands go through a POSIX shell. A Windows machine reached over OpenSSH answers through
//! WSL or Git Bash and works; one whose shell is `cmd` or PowerShell is told so in as many words
//! rather than left to fail a command at a time.

use std::sync::Arc;

use sandbox::{Error, Exec, Listed, Output, Provider, Result, Sandbox, Spec};

use crate::manager::Connection;

/// Where a workspace goes when the machine will not say where home is.
const FALLBACK_ROOT: &str = "/tmp";
/// What a command killed by `timeout` exits with, by long convention.
const TIMEOUT_EXIT: i32 = 124;

/// One saved machine, reached through the connection manager so a terminal, a file tree and a
/// sandbox on the same host share one SSH session.
pub struct Machine {
    connection: Arc<Connection>,
}

impl Machine {
    pub fn new(connection: Arc<Connection>) -> Self {
        Self { connection }
    }

    fn name(&self) -> &str {
        &self.connection.saved.name
    }

    /// Runs `command` through a login shell, with the failure said the way the connection form
    /// says its failures.
    fn run(&self, command: &str, stdin: Option<&[u8]>, what: &str) -> Result<crate::session::ExecOutput> {
        self.connection.exec(command, stdin).map_err(|error| failed(&error, what, self.name()))
    }

    /// The remote user's home, asked once per call because a machine is free to be a different
    /// machine between sessions.
    fn root(&self) -> String {
        self.connection
            .home_dir()
            .ok()
            .map(|home| home.trim_end_matches('/').to_string())
            .filter(|home| !home.is_empty())
            .unwrap_or_else(|| FALLBACK_ROOT.to_string())
    }

    /// Checks the machine answers a POSIX shell before anything is copied to it. A `cmd.exe`
    /// that cannot run `uname` would otherwise fail later, in the middle of a tar.
    fn check_shell(&self) -> Result<()> {
        let probed = self.run("uname -s", None, "Opening the machine")?;
        if probed.status == 0 && !probed.stdout.is_empty() {
            return Ok(());
        }
        Err(Error::unavailable(format!(
            "{} answered no POSIX shell. Athas runs a machine's commands through `sh`; on Windows, point the connection at WSL or set OpenSSH's default shell to Git Bash.",
            self.name()
        )))
    }

    fn handle(&self, root: String) -> Sandbox {
        Sandbox {
            provider: self.provider_id(),
            id: self.connection.saved.id.clone(),
            host: self.connection.saved.location(),
            access_token: None,
            root,
        }
    }

    fn provider_id(&self) -> String {
        format!("{}{}", sandbox::providers::MACHINE_PREFIX, self.connection.saved.id)
    }
}

/// An SSH failure in the shape a sandbox caller acts on. Authentication is the user's to fix and
/// everything else is worth another try, which is the only distinction that changes what happens.
fn failed(error: &anyhow::Error, what: &str, name: &str) -> Error {
    let friendly = crate::session::friendly_error(error);
    let lower = friendly.to_lowercase();
    if lower.contains("authentic") || lower.contains("password") || lower.contains("permission denied") || lower.contains("host key") {
        return Error::auth(format!("{what}: {name} refused the connection. {friendly}"));
    }
    Error::unavailable(format!("{what}: {friendly}"))
}

/// The command with its directory and its environment in front of it: what the remote shell is
/// asked to run, before anything is wrapped around it.
fn script_of(exec: &Exec) -> String {
    let mut script = String::new();
    if let Some(cwd) = &exec.cwd {
        script.push_str(&format!("cd {} || exit 1\n", quote(cwd)));
    }
    for (name, value) in &exec.env {
        script.push_str(&format!("export {name}={}\n", quote(value)));
    }
    script.push_str(&exec.command);
    script
}

/// The script with a leash around it, where the machine has one to put it on. `timeout` is GNU's
/// and not on every machine; without it the command runs as long as it likes, which is the same
/// as having no timeout rather than a failure.
fn wrapped(exec: &Exec) -> String {
    let seconds = exec.timeout.as_secs().max(1);
    let inner = quote(&script_of(exec));
    format!("if command -v timeout >/dev/null 2>&1; then timeout {seconds} sh -lc {inner}; else sh -lc {inner}; fi")
}

/// A value the remote shell reads as one word, however it is spelled.
fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', r"'\''"))
}

impl Provider for Machine {
    fn id(&self) -> &str {
        // Borrowed from the connection so the id outlives the call, and it is the same string
        // the Environment menu chose.
        &self.connection.saved.id
    }

    fn list(&self) -> Result<Vec<Listed>> {
        // A machine is one machine. Listing it is how the menu shows whether it answers at all,
        // so this connects rather than reports what was true last time.
        self.check_shell()?;
        Ok(vec![Listed {
            id: self.connection.saved.id.clone(),
            template: self.connection.saved.location(),
            state: "running".into(),
            started_at: None,
            ends_at: None,
            cpus: 0,
            memory_mb: 0,
        }])
    }

    fn create(&self, _spec: &Spec) -> Result<Sandbox> {
        // Nothing is provisioned: the machine is already there. What this does is connect, and
        // refuse early if the machine cannot run what Athas is about to send it.
        self.check_shell()?;
        Ok(self.handle(self.root()))
    }

    fn attach(&self, _id: &str) -> Result<Sandbox> {
        self.check_shell()?;
        Ok(self.handle(self.root()))
    }

    fn exec(&self, _sandbox: &Sandbox, exec: &Exec) -> Result<Output> {
        let finished = self.run(&wrapped(exec), None, "Running a command")?;
        let timed_out = finished.status == TIMEOUT_EXIT;
        Ok(Output {
            exit_code: (!timed_out).then_some(finished.status),
            stdout: String::from_utf8_lossy(&finished.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&finished.stderr).into_owned(),
            timed_out,
        })
    }

    fn write_file(&self, _sandbox: &Sandbox, path: &str, bytes: &[u8]) -> Result<()> {
        let what = format!("Writing {path}");
        let command = format!("mkdir -p \"$(dirname {quoted})\" && cat > {quoted}", quoted = quote(path));
        let finished = self.run(&command, Some(bytes), &what)?;
        match finished.status {
            0 => Ok(()),
            _ => Err(Error::unavailable(format!("{what}: {}", String::from_utf8_lossy(&finished.stderr).trim()))),
        }
    }

    fn read_file(&self, _sandbox: &Sandbox, path: &str) -> Result<Vec<u8>> {
        let what = format!("Reading {path}");
        let finished = self.run(&format!("cat {}", quote(path)), None, &what)?;
        match finished.status {
            0 => Ok(finished.stdout),
            _ => Err(Error::gone(format!("{what}: {}", String::from_utf8_lossy(&finished.stderr).trim()))),
        }
    }

    fn keep_alive(&self, _sandbox: &Sandbox, _seconds: u32) -> Result<()> {
        // A machine has no lease. Saying so costs nothing and keeps the caller's loop the same
        // for every provider.
        Ok(())
    }

    fn dispose(&self, _sandbox: &Sandbox) -> Result<()> {
        // Deliberately nothing. Every other provider's dispose destroys what it made; this one
        // was not made by Athas, and a session ending is not a reason to touch someone's
        // computer. Disconnecting is the connections panel's to offer.
        Ok(())
    }
}

/// The saved connections, as the Environment menu's machines.
struct Saved;

impl sandbox::machines::Machines for Saved {
    fn list(&self) -> Vec<sandbox::machines::Machine> {
        let connected = crate::manager::manager().connected_ids();
        crate::connections::load_default()
            .into_iter()
            .map(|saved| sandbox::machines::Machine {
                connected: connected.iter().any(|id| id == &saved.id),
                location: saved.location(),
                name: saved.name,
                id: saved.id,
            })
            .collect()
    }

    fn provider(&self, machine: &str) -> Result<Box<dyn Provider>> {
        let connection = crate::manager::manager()
            .get_or_connect(machine)
            .map_err(|error| failed(&error, "Opening the machine", machine))?;
        Ok(Box::new(Machine::new(connection)))
    }
}

/// Makes the saved connections answer the Environment menu. Called once, beside [`crate::init`].
pub fn init() {
    sandbox::machines::set_source(Arc::new(Saved));
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use sandbox::Exec;

    #[test]
    fn a_command_carries_its_directory_and_its_environment_in_front_of_it() {
        let mut exec = Exec::new("cargo test").in_dir("/home/me/project").with_timeout(Duration::from_secs(90));
        exec.env.insert("RUST_LOG".into(), "debug".into());

        let script = super::script_of(&exec);

        assert_eq!(script, "cd '/home/me/project' || exit 1\nexport RUST_LOG='debug'\ncargo test");
    }

    #[test]
    fn a_command_is_given_the_timeout_it_asked_for_where_the_machine_can_enforce_one() {
        let exec = Exec::new("sleep 9999").with_timeout(Duration::from_secs(90));

        let wrapped = super::wrapped(&exec);

        assert!(wrapped.starts_with("if command -v timeout >/dev/null 2>&1; then timeout 90 sh -lc "), "{wrapped}");
        // A machine without GNU coreutils still runs it, just without the leash: no timeout is a
        // better answer than no command.
        assert!(wrapped.contains("; else sh -lc "), "{wrapped}");
        assert!(wrapped.ends_with("; fi"), "{wrapped}");
    }

    #[test]
    fn a_directory_with_a_quote_in_it_is_still_one_word() {
        assert_eq!(super::quote("/home/me/it's"), r"'/home/me/it'\''s'");
    }

    #[test]
    fn a_refused_login_is_the_users_to_fix_and_a_dropped_link_is_worth_retrying() {
        let refused = super::failed(&anyhow::anyhow!("Authentication failed"), "Running a command", "Build box");
        assert_eq!(refused.kind, sandbox::ErrorKind::Auth);
        assert!(!refused.is_retryable());
        let dropped = super::failed(&anyhow::anyhow!("Connection reset by peer"), "Running a command", "Build box");
        assert!(dropped.is_retryable());
    }
}
