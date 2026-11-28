//! Running a session's commands somewhere that is not this machine.
//!
//! The agent never knows. It asks the client for a terminal, as it always has (`terminal/create`),
//! and the client decides where that terminal is: a child process here, or a command in a sandbox
//! on the user's own provider account. That is why this sits beside [`super::host`] and not inside
//! the built-in agent -- every agent that speaks ACP gets it, Claude Code and Gemini included.
//!
//! What goes over and what comes back:
//!
//! - The workspace is copied in before each command, as one tar of the files that changed since
//!   the last copy. The agent edits files on this machine (that is what the diff and the review
//!   are for), so without this the sandbox would be running yesterday's code.
//! - What the command changed comes back after it, through `git status` inside the sandbox. A
//!   workspace that is not a git repository gets nothing back and is told so once: without git
//!   there is no cheap way to know what a command touched, and copying a whole tree back after
//!   every `ls` is not a trade worth making.
//!
//! Known limits, so they are not discovered as bugs: output arrives when the command ends rather
//! than line by line, a file the command deleted is not deleted here, and the sandbox is thrown
//! away with the session, not kept between them.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, SystemTime},
};

use gpui::App;

use sandbox::Provider;

/// How long a sandbox is given before the provider stops it. Pushed out again before every
/// command, so an idle session costs an hour at most and a working one is never cut off.
const SANDBOX_SECONDS: u32 = 60 * 60;
/// A command runs no longer than this, whatever it is doing.
const COMMAND_TIMEOUT: Duration = Duration::from_secs(15 * 60);
/// What the tar of changed files is called where it lands. It goes in the sandbox user's own
/// home, not `/tmp`: a file written there once belongs to whoever wrote it, and the next copy
/// comes back "permission denied".
const SYNC_ARCHIVE: &str = ".athas-sync.tar.gz";
/// A file bigger than this is not worth copying into a sandbox; it is build output or data.
const MAX_SYNC_BYTES: u64 = 8 * 1024 * 1024;

/// What a command in the sandbox left behind.
pub struct SandboxRun {
    pub output: String,
    pub exit_code: Option<i32>,
    /// Files the command changed, already written back to this machine.
    pub pulled: usize,
}

/// The sandbox a session's commands run in, when the setting is on and an enabled integration
/// offers a provider. Nothing is created and the keychain is not touched here: a session that
/// never runs a command never makes a sandbox.
pub fn for_session(cwd: &Path, cx: &App) -> Option<Arc<SandboxRuntime>> {
    if !settings::get(cx).ai_sandbox_commands {
        return None;
    }
    let (_, provider) = extensions::get(cx).sandbox_providers().into_iter().next()?;
    Some(Arc::new(SandboxRuntime::new(&provider.id, cwd.to_path_buf())))
}

/// What `provider` has right now: the account's sandboxes, the machine's own answer, the
/// containers on this computer. `None` when the provider is not ready to be asked -- no key
/// saved, no client in this build -- which is different from an account with nothing in it.
/// Blocking: the caller runs it on a background thread.
pub fn list(provider: &str) -> Option<Vec<sandbox::Listed>> {
    if !sandbox::providers::is_ready(provider) {
        return None;
    }
    sandbox::providers::connect(provider).and_then(|client| client.list()).ok()
}

/// One session's sandbox: made when its first command runs, kept until the session is done.
pub struct SandboxRuntime {
    provider: String,
    /// Built on the first command, not when the session opens: making it needs the key, and the
    /// keychain is not something to ask on the thread that draws.
    client: std::sync::OnceLock<Box<dyn Provider>>,
    /// The workspace on this machine.
    root: PathBuf,
    /// A sandbox the user picked out of the ones their account already has. Without one, this
    /// session makes its own with its first command.
    existing: Option<String>,
    live: Mutex<Option<Live>>,
    /// Commands that have actually run in there. The question "did it really run in the sandbox"
    /// deserves a number, not a guess.
    ran: std::sync::atomic::AtomicUsize,
    /// When each file was last copied over, so only what changed goes again.
    pushed: Mutex<HashMap<PathBuf, SystemTime>>,
}

struct Live {
    handle: sandbox::Sandbox,
    /// The workspace's path inside the sandbox.
    dir: String,
    /// Whether the workspace carries a `.git`, which is what makes changes findable.
    git: bool,
}

impl SandboxRuntime {
    pub fn new(provider: &str, root: PathBuf) -> Self {
        Self {
            provider: provider.to_string(),
            client: std::sync::OnceLock::new(),
            root,
            existing: None,
            live: Mutex::default(),
            ran: std::sync::atomic::AtomicUsize::new(0),
            pushed: Mutex::default(),
        }
    }

    /// Runs in a sandbox the account already has instead of making one.
    pub fn attached(provider: &str, root: PathBuf, sandbox: &str) -> Self {
        let mut runtime = Self::new(provider, root);
        runtime.existing = Some(sandbox.to_string());
        runtime
    }

    /// The sandbox this session was pointed at, if it was pointed at one.
    pub fn attached_to(&self) -> Option<&str> {
        self.existing.as_deref()
    }

    /// The provider's client, made on first use from the key in the keychain. A provider this
    /// build has no client for, or one with no key, has no sandbox to offer.
    fn client(&self) -> Result<&dyn Provider, String> {
        if let Some(client) = self.client.get() {
            return Ok(client.as_ref());
        }
        let client = sandbox::providers::connect(&self.provider).map_err(|error| error.message)?;
        let _ = self.client.set(client);
        self.client.get().map(Box::as_ref).ok_or_else(|| "The sandbox client could not be made.".to_string())
    }

    pub fn provider(&self) -> &str {
        &self.provider
    }

    /// How many commands have run in there.
    pub fn commands_run(&self) -> usize {
        self.ran.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// The sandbox this session is in right now, if its first command has run. Before that there
    /// is a place its commands will go and nothing running yet, which is worth saying out loud.
    pub fn current_id(&self) -> Option<String> {
        self.live.lock().unwrap_or_else(|poison| poison.into_inner()).as_ref().map(|live| live.handle.id.clone())
    }

    /// Makes or opens the sandbox now, instead of waiting for a command to need one. Returns the
    /// workspace's path inside it.
    pub fn ensure(&self) -> Result<String, String> {
        self.start()
    }

    /// Copies the workspace over now. Everything that changed since the last copy, which the
    /// first time is everything.
    pub fn send_workspace(&self) -> Result<usize, String> {
        self.start()?;
        self.push()
    }

    /// Copies one file over, now. Only into a sandbox that is already running: a file being
    /// written is no reason to make one, and the next command copies it anyway.
    pub fn send_file(&self, path: &Path) -> Result<(), String> {
        let (Some(dir), Ok(relative)) = (self.dir(), path.strip_prefix(&self.root)) else { return Ok(()) };
        let bytes = std::fs::read(path).map_err(|error| error.to_string())?;
        let handle = self.handle()?;
        let remote = format!("{dir}/{}", relative.to_string_lossy());
        self.client()?.write_file(&handle, &remote, &bytes).map_err(|error| error.message)?;
        if let Ok(modified) = std::fs::metadata(path).and_then(|data| data.modified()) {
            self.pushed.lock().unwrap_or_else(|poison| poison.into_inner()).insert(path.to_path_buf(), modified);
        }
        Ok(())
    }

    /// Runs one command and brings back what it changed. Blocking from end to end: the caller
    /// runs it on a thread of its own, as the local terminal does.
    pub fn run(&self, command: &str, timeout: Option<Duration>) -> Result<SandboxRun, String> {
        let dir = self.start()?;
        let pushed = self.push()?;
        let exec = sandbox::Exec::new(command).in_dir(dir).with_timeout(timeout.unwrap_or(COMMAND_TIMEOUT));
        let handle = self.handle()?;
        let output = self.client()?.exec(&handle, &exec).map_err(|error| error.message)?;
        let mut text = output.stdout;
        if !output.stderr.is_empty() {
            text.push_str(&output.stderr);
        }
        if output.timed_out {
            text.push_str("\nThe command ran out of time and the sandbox stopped it.\n");
        }
        self.ran.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let pulled = self.pull().unwrap_or_default();
        let _ = pushed;
        Ok(SandboxRun { output: text, exit_code: output.exit_code, pulled })
    }

    /// The sandbox, made on first use. Returns the workspace's path inside it.
    fn start(&self) -> Result<String, String> {
        let mut live = self.live.lock().unwrap_or_else(|poison| poison.into_inner());
        if let Some(live) = live.as_ref() {
            // An existing sandbox is given its hour again; a session that pauses for lunch comes
            // back to the same machine instead of a dead one.
            if let Ok(client) = self.client() {
                let _ = client.keep_alive(&live.handle, SANDBOX_SECONDS);
            }
            return Ok(live.dir.clone());
        }
        let name = self.root.file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or_else(|| "workspace".into());
        let spec = sandbox::Spec {
            timeout_seconds: Some(SANDBOX_SECONDS),
            metadata: [("athas".to_string(), name.clone())].into_iter().collect(),
            ..sandbox::Spec::default()
        };
        let handle = match &self.existing {
            // Picked out of the account's own sandboxes: opened, not made.
            Some(id) => self.client()?.attach(id).map_err(|error| error.message)?,
            None => self.client()?.create(&spec).map_err(|error| error.message)?,
        };
        let dir = format!("{}/{}", handle.root.trim_end_matches('/'), sanitize(&name));
        let exec = sandbox::Exec::new(format!("mkdir -p {dir}")).with_timeout(Duration::from_secs(30));
        self.client()?.exec(&handle, &exec).map_err(|error| error.message)?;
        let git = self.root.join(".git").exists();
        *live = Some(Live { handle, dir: dir.clone(), git });
        Ok(dir)
    }

    fn handle(&self) -> Result<sandbox::Sandbox, String> {
        self.live
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .as_ref()
            .map(|live| live.handle.clone())
            .ok_or_else(|| "The sandbox is not running.".to_string())
    }

    fn dir(&self) -> Option<String> {
        self.live.lock().unwrap_or_else(|poison| poison.into_inner()).as_ref().map(|live| live.dir.clone())
    }

    fn is_git(&self) -> bool {
        self.live.lock().unwrap_or_else(|poison| poison.into_inner()).as_ref().is_some_and(|live| live.git)
    }

    /// Copies over every file that changed since the last time, as one tar: a thousand files one
    /// request at a time would cost more than the command does.
    fn push(&self) -> Result<usize, String> {
        let (archive, count) = self.changed_files_archive()?;
        if count == 0 {
            return Ok(0);
        }
        let handle = self.handle()?;
        let dir = self.dir().ok_or("The sandbox is not running.")?;
        let archive_path = format!("{}/{SYNC_ARCHIVE}", handle.root.trim_end_matches('/'));
        self.client()?.write_file(&handle, &archive_path, &archive).map_err(|error| error.message)?;
        let unpack = sandbox::Exec::new(format!("tar xzf {archive_path} -C {dir} && rm -f {archive_path}"))
            .with_timeout(Duration::from_secs(120));
        let result = self.client()?.exec(&handle, &unpack).map_err(|error| error.message)?;
        if !result.succeeded() {
            return Err(format!("The workspace could not be unpacked in the sandbox. {}", result.stderr.trim()));
        }
        Ok(count)
    }

    /// A tar of what changed, and how many files went in. Walks the workspace the way the agent's
    /// own tools read it -- `.gitignore` and the rest -- so build output and `node_modules` stay
    /// where they are.
    fn changed_files_archive(&self) -> Result<(Vec<u8>, usize), String> {
        let mut pushed = self.pushed.lock().unwrap_or_else(|poison| poison.into_inner());
        let mut builder = tar::Builder::new(flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast()));
        let mut count = 0;
        for entry in ignore::WalkBuilder::new(&self.root)
            .hidden(false)
            .git_ignore(true)
            // Without this the walker only honours `.gitignore` inside a git repository, and a
            // workspace that is not one would send its `target` and `node_modules` over the wire.
            .require_git(false)
            .build().flatten() {
            let path = entry.path();
            if entry.file_type().is_none_or(|kind| !kind.is_file()) || path.components().any(|part| part.as_os_str() == ".git") {
                continue;
            }
            let Ok(metadata) = std::fs::metadata(path) else { continue };
            if metadata.len() > MAX_SYNC_BYTES {
                continue;
            }
            let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
            if pushed.get(path).is_some_and(|last| *last >= modified) {
                continue;
            }
            let Ok(relative) = path.strip_prefix(&self.root) else { continue };
            if builder.append_path_with_name(path, relative).is_err() {
                continue;
            }
            pushed.insert(path.to_path_buf(), modified);
            count += 1;
        }
        let encoder = builder.into_inner().map_err(|error| error.to_string())?;
        let archive = encoder.finish().map_err(|error| error.to_string())?;
        Ok((archive, count))
    }

    /// Writes back what the command changed. `git status` is the cheap question: it is what the
    /// repository itself uses to answer "what is different", and it costs one command.
    fn pull(&self) -> Result<usize, String> {
        if !self.is_git() {
            return Ok(0);
        }
        let handle = self.handle()?;
        let dir = self.dir().ok_or("The sandbox is not running.")?;
        let status = sandbox::Exec::new("git status --porcelain --untracked-files=all")
            .in_dir(dir.clone())
            .with_timeout(Duration::from_secs(60));
        let listed = self.client()?.exec(&handle, &status).map_err(|error| error.message)?;
        if !listed.succeeded() {
            return Ok(0);
        }
        let mut pulled = 0;
        for line in listed.stdout.lines() {
            // "XY path", and " R  old -> new" for a rename, whose new name is what matters here.
            let Some(path) = line.get(3..).map(str::trim) else { continue };
            let path = path.rsplit(" -> ").next().unwrap_or(path).trim_matches('"');
            if path.is_empty() || line.starts_with(" D") || line.starts_with("D ") {
                continue;
            }
            let local = self.root.join(path);
            if !local.starts_with(&self.root) {
                continue;
            }
            let remote = format!("{dir}/{path}");
            let Ok(bytes) = self.client()?.read_file(&handle, &remote) else { continue };
            if let Some(parent) = local.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if std::fs::write(&local, &bytes).is_ok() {
                // Written here, so the next push does not send it straight back.
                if let Ok(modified) = std::fs::metadata(&local).and_then(|data| data.modified()) {
                    self.pushed.lock().unwrap_or_else(|poison| poison.into_inner()).insert(local, modified);
                }
                pulled += 1;
            }
        }
        Ok(pulled)
    }

    /// What to say above a command's output, so it is never a surprise where it ran, or which
    /// sandbox it ran in.
    pub fn banner(&self) -> String {
        let where_ = match self.current_id() {
            Some(id) => format!("Running in {} sandbox {id}.", self.provider),
            None => format!("Running in a new {} sandbox.", self.provider),
        };
        match self.is_git() {
            true => format!("{where_}\n"),
            false => format!("{where_} This workspace is not a git repository, so nothing is copied back.\n"),
        }
    }
}

// A sandbox outlives the session that made it on purpose. Athas restarts -- a rebuild, a quit,
// a crash -- and a sandbox thrown away with it is one the user watched disappear after asking
// for it. The leash is the provider's own: an hour, pushed out again before every command, so an
// abandoned one stops costing money on its own and a working one is never cut off. Stopping it
// is a choice, on the provider's page in Integrations.

/// A folder name a shell will not read as anything but a folder name.
fn sanitize(name: &str) -> String {
    let cleaned: String = name.chars().map(|letter| if letter.is_ascii_alphanumeric() || letter == '-' || letter == '_' { letter } else { '-' }).collect();
    match cleaned.trim_matches('-') {
        "" => "workspace".into(),
        trimmed => trimmed.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_folder_name_becomes_something_a_shell_cannot_misread() {
        assert_eq!(sanitize("my project"), "my-project");
        assert_eq!(sanitize("athas"), "athas");
        assert_eq!(sanitize("../etc"), "etc");
        assert_eq!(sanitize("$(rm -rf /)"), "rm--rf");
        assert_eq!(sanitize("..."), "workspace");
    }

    #[test]
    fn only_what_changed_since_the_last_copy_goes_again() {
        let dir = tempfile::tempdir().expect("a temporary workspace");
        std::fs::write(dir.path().join("a.rs"), "fn a() {}").expect("a file");
        std::fs::write(dir.path().join("b.rs"), "fn b() {}").expect("another file");
        let runtime = SandboxRuntime::new("e2b", dir.path().to_path_buf());

        let (_, first) = runtime.changed_files_archive().expect("the first archive");
        let (_, second) = runtime.changed_files_archive().expect("the second archive");
        std::fs::write(dir.path().join("a.rs"), "fn a() { changed() }").expect("the file changes");
        let (_, third) = runtime.changed_files_archive().expect("the third archive");

        assert_eq!(first, 2, "the first copy sends the whole workspace");
        assert_eq!(second, 0, "nothing changed, so nothing goes again");
        assert_eq!(third, 1, "only the file that changed");
    }

    #[test]
    fn what_git_ignores_is_never_copied_into_a_sandbox() {
        let dir = tempfile::tempdir().expect("a temporary workspace");
        std::fs::write(dir.path().join(".gitignore"), "target\n").expect("an ignore file");
        std::fs::create_dir(dir.path().join("target")).expect("a build folder");
        std::fs::write(dir.path().join("target/huge.bin"), "x").expect("build output");
        std::fs::write(dir.path().join("src.rs"), "fn main() {}").expect("a source file");
        let runtime = SandboxRuntime::new("e2b", dir.path().to_path_buf());

        let (_, count) = runtime.changed_files_archive().expect("the archive");

        // `.gitignore` and `src.rs`, and nothing from `target`.
        assert_eq!(count, 2);
    }

    #[test]
    fn a_provider_this_build_has_no_client_for_says_so_instead_of_running_anything() {
        let runtime = SandboxRuntime::new("daytona", PathBuf::from("/tmp"));

        let error = runtime.client().err().expect("there is no Daytona client");

        // No key saved under that name either, so that is the first thing it is missing.
        assert!(error.contains("daytona"), "{error}");
    }
}
