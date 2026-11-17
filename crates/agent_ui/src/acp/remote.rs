//! Agents that run on a workspace server instead of this machine. The web build installs a
//! [`RemoteAgents`]; agent sessions then start their agent there and talk ACP to it over the
//! server's socket. The agent reads and writes the project and runs its tools on the server, so
//! the connection offers it no client file system or terminals.

use std::{
    any::Any,
    path::Path,
    sync::{Arc, OnceLock},
};

use super::rpc::Transport;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RemoteError {
    /// The agent's program is not on the server; the message says where it was looked for.
    NotInstalled(String),
    Failed(String),
}

pub trait RemoteAgents: Send + Sync {
    /// Starts `agent`, whose catalog runs `program` with `args`, in `cwd`. Dropping the handle stops
    /// it.
    fn start(&self, agent: &str, program: &str, args: &[String], cwd: &Path) -> Result<(Transport, Box<dyn Any>), RemoteError>;
}

static REMOTE: OnceLock<Arc<dyn RemoteAgents>> = OnceLock::new();

pub fn set_remote_agents(agents: Arc<dyn RemoteAgents>) {
    let _ = REMOTE.set(agents);
}

pub fn remote_agents() -> Option<Arc<dyn RemoteAgents>> {
    REMOTE.get().cloned()
}
