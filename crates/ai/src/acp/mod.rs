mod auth;
mod bridge;
mod bridge_commands;
mod bridge_init;
mod bridge_prompt;
mod client;
mod config;
mod file_access;
pub mod mcp_servers;
mod process;
pub mod registry;
mod replay;
mod sessions;
mod terminal_events;
mod terminal_meta;
mod terminal_state;
pub mod traffic;
mod traffic_secrets;
pub mod types;
mod workspace_path;

pub use bridge::AcpAgentBridge;
pub use bridge_init::AgentLaunchEnv;
/// Shared with Athas's own agent, so its writes and ACP writes never reuse an id.
pub use file_access::next_agent_write_id;
pub use mcp_servers::{McpServerConfig, McpServerSecrets, McpServerSetting};
pub use traffic::TrafficInspector;
pub use types::{
   AcpAgentStatus, AcpOpenedSession, AcpSessionInfo, AcpSessionList, AgentConfig, AgentRuntime,
   AgentSource, RegistryAgentInfo, SessionConfigValue,
};

pub(super) type AcpConnection = agent_client_protocol::ConnectionTo<agent_client_protocol::Agent>;
