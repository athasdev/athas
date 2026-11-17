//! Agents on the workspace server: `agent.start` runs one there, and its ACP messages travel over
//! the socket. What the agent writes arrives as `agent.message` ([`Events`]); what the session
//! sends waits there until the socket sends it ([`send_input`](crate::send_input)).

use std::{
    any::Any,
    path::{Path, PathBuf},
    sync::Arc,
};

use agent_ui::acp::{
    remote::{RemoteAgents, RemoteError},
    rpc::Transport as AcpTransport,
};
use serde_json::json;

use crate::{Events, Transport, relative};

pub struct RemoteAgentHost {
    root: PathBuf,
    transport: Arc<dyn Transport>,
    events: Arc<Events>,
}

impl RemoteAgentHost {
    pub fn new(root: PathBuf, transport: Arc<dyn Transport>, events: Arc<Events>) -> Self {
        Self { root, transport, events }
    }
}

/// The server's end of an agent; dropping it stops the process.
struct RemoteAgent {
    id: String,
    transport: Arc<dyn Transport>,
    events: Arc<Events>,
}

impl Drop for RemoteAgent {
    fn drop(&mut self) {
        self.events.remove_agent(&self.id);
        self.transport.notify("agent.stop", json!({ "id": self.id }));
    }
}

impl RemoteAgents for RemoteAgentHost {
    fn start(&self, agent: &str, program: &str, args: &[String], cwd: &Path) -> Result<(AcpTransport, Box<dyn Any>), RemoteError> {
        let cwd = relative(&self.root, cwd).unwrap_or_default();
        let started = self
            .transport
            .call("agent.start", json!({ "agent": agent, "command": program, "args": args, "cwd": cwd }))
            .map_err(|error| match error.code.as_str() {
                "not_installed" => RemoteError::NotInstalled(error.message),
                _ => RemoteError::Failed(error.message),
            })?;
        let id = started["id"].as_str().ok_or_else(|| RemoteError::Failed("The workspace server started no agent.".into()))?.to_string();
        let (to_agent, outgoing) = futures::channel::mpsc::unbounded();
        let (incoming, from_agent) = futures::channel::mpsc::unbounded();
        self.events.add_agent(id.clone(), incoming, outgoing);
        let handle = RemoteAgent { id, transport: self.transport.clone(), events: self.events.clone() };
        Ok((AcpTransport { outgoing: to_agent, incoming: from_agent }, Box::new(handle)))
    }
}
