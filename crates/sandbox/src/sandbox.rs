//! A client for code sandboxes the user's own provider account runs (`crates/sandbox`): make a
//! machine somewhere else, run a command in it, move files in and out, throw it away. This is the
//! client side only -- nothing here knows about the agent, the editor or GPUI.
//!
//! One trait, [`Provider`], and several behind it: [`e2b`], [`daytona`] and [`boat`] on the
//! user's own account, [`docker`] on this machine, and a saved SSH connection through
//! [`machines`]. Providers disagree about almost everything (a port is a URL to one and a
//! hostname to another, files are multipart here, base64 there and a stream somewhere else), so
//! the trait stays narrow: the four things a sandbox has to do are run a command, take a file,
//! give a file back, and stop costing money.
//!
//! [`providers`] is the one place that maps a name to a client. Add a provider there and the
//! agent, the Integrations page and the Environment menu all find it at once.
//!
//! Every call blocks and takes between a few hundred milliseconds and a few seconds. Call them
//! from a background executor, the way `telemetry::send` is called, never from `render`.

pub mod connect;
#[cfg(not(target_family = "wasm"))]
pub mod boat;
#[cfg(not(target_family = "wasm"))]
pub mod daytona;
#[cfg(not(target_family = "wasm"))]
pub mod docker;
#[cfg(not(target_family = "wasm"))]
pub mod e2b;
#[cfg(not(target_family = "wasm"))]
pub mod keys;
#[cfg(not(target_family = "wasm"))]
pub mod machines;
#[cfg(not(target_family = "wasm"))]
pub mod providers;
#[cfg(test)]
mod tests;

use std::{collections::BTreeMap, fmt, time::Duration};

/// Where a workspace goes inside the sandbox unless the caller names somewhere else.
pub const DEFAULT_ROOT: &str = "/home/user";
/// What a sandbox is given to live when the caller does not say.
pub const DEFAULT_TIMEOUT_SECONDS: u32 = 5 * 60;

/// What went wrong, in the only four shapes a caller acts on differently.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ErrorKind {
    /// The key was refused. Retrying will not help; the user has to fix it.
    Auth,
    /// The sandbox is not there any more -- it expired, or something else killed it. Make another.
    Gone,
    /// The provider could not be reached or failed in a way worth retrying.
    Unavailable,
    /// The provider answered something this client could not read. A bug here or a changed API.
    Protocol,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Error {
    pub kind: ErrorKind,
    pub message: String,
}

impl Error {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self { kind, message: message.into() }
    }

    pub fn auth(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Auth, message)
    }

    pub fn gone(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Gone, message)
    }

    pub fn unavailable(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Unavailable, message)
    }

    pub fn protocol(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Protocol, message)
    }

    /// Whether another attempt could succeed without the user doing anything.
    pub fn is_retryable(&self) -> bool {
        matches!(self.kind, ErrorKind::Unavailable)
    }
}

impl fmt::Display for Error {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for Error {}

pub type Result<T> = std::result::Result<T, Error>;

/// What to ask the provider for. Everything is optional: the defaults are a plain Linux box.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Spec {
    /// The provider's image or template name; `None` takes the provider's own default.
    pub template: Option<String>,
    /// How long the sandbox lives without a [`Provider::keep_alive`].
    pub timeout_seconds: Option<u32>,
    /// Environment every command in this sandbox starts with.
    pub env: BTreeMap<String, String>,
    /// Labels the provider shows in its dashboard, so a sandbox left behind can be recognised.
    pub metadata: BTreeMap<String, String>,
}

impl Spec {
    pub fn timeout_seconds(&self) -> u32 {
        self.timeout_seconds.unwrap_or(DEFAULT_TIMEOUT_SECONDS)
    }
}

/// A sandbox that exists right now. Cheap to clone and safe to keep: it holds no connection, only
/// what the provider needs to be addressed again.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Sandbox {
    /// Which provider made it, so a handle saved to disk is never used against another.
    pub provider: String,
    pub id: String,
    /// The base URL the sandbox's own services answer on, when the provider gives one.
    pub host: String,
    /// What those services want instead of the account key, when they want their own.
    pub access_token: Option<String>,
    pub root: String,
}

/// A command to run. The provider decides the shell; the caller writes one command line.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Exec {
    pub command: String,
    /// Relative paths are the provider's business; pass an absolute path to be sure.
    pub cwd: Option<String>,
    pub env: BTreeMap<String, String>,
    pub timeout: Duration,
}

impl Exec {
    pub fn new(command: impl Into<String>) -> Self {
        Self { command: command.into(), cwd: None, env: BTreeMap::new(), timeout: Duration::from_secs(120) }
    }

    pub fn in_dir(mut self, cwd: impl Into<String>) -> Self {
        self.cwd = Some(cwd.into());
        self
    }

    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }
}

/// What a command left behind. `exit_code` is `None` when the command never got to exit, which is
/// what a timeout looks like from here.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Output {
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
}

impl Output {
    pub fn succeeded(&self) -> bool {
        self.exit_code == Some(0)
    }
}

/// A sandbox the account already has, as the provider lists it. Less than a [`Sandbox`]: enough
/// to show it and to stop it, not enough to run anything in it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Listed {
    pub id: String,
    pub template: String,
    /// The provider's own word -- `running`, `paused`. Not an enum: a provider is free to add
    /// states, and a state this client has never heard of is still worth showing.
    pub state: String,
    /// When it started, in the provider's own format.
    pub started_at: Option<String>,
    /// When the provider will stop it on its own, in the provider's own format.
    pub ends_at: Option<String>,
    pub cpus: u32,
    pub memory_mb: u32,
}

impl Listed {
    pub fn is_running(&self) -> bool {
        self.state.eq_ignore_ascii_case("running")
    }

    /// A handle good for stopping this sandbox, and only for that: a listed sandbox has no host
    /// and no token until the provider is asked for one, so nothing can be run in it from here.
    pub fn handle(&self, provider: &str) -> Sandbox {
        Sandbox {
            provider: provider.to_string(),
            id: self.id.clone(),
            host: String::new(),
            access_token: None,
            root: DEFAULT_ROOT.to_string(),
        }
    }
}

pub trait Provider: Send + Sync {
    /// The name this provider is saved and shown under (`"e2b"`).
    fn id(&self) -> &str;
    /// The sandboxes this account has right now. Also the cheapest question that needs a valid
    /// key, which makes it how a key is checked.
    fn list(&self) -> Result<Vec<Listed>>;
    fn create(&self, spec: &Spec) -> Result<Sandbox>;
    /// A handle to a sandbox that already exists, good for running in it. Listing gives only
    /// enough to show one; this asks the provider for what it takes to reach into it.
    fn attach(&self, id: &str) -> Result<Sandbox>;
    fn exec(&self, sandbox: &Sandbox, exec: &Exec) -> Result<Output>;
    fn write_file(&self, sandbox: &Sandbox, path: &str, bytes: &[u8]) -> Result<()>;
    fn read_file(&self, sandbox: &Sandbox, path: &str) -> Result<Vec<u8>>;
    /// Pushes the end of the sandbox's life out. A command that runs longer than the sandbox was
    /// given needs this, or it is killed half way through its own work.
    fn keep_alive(&self, sandbox: &Sandbox, seconds: u32) -> Result<()>;
    /// Stops the sandbox. A sandbox already gone is not an error: the point was for it to be gone.
    fn dispose(&self, sandbox: &Sandbox) -> Result<()>;
}
