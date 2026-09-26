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
mod terminal_meta;
mod terminal_state;
pub mod traffic;
pub mod types;
mod workspace_path;

pub use bridge::AcpAgentBridge;
pub use mcp_servers::{McpServerConfig, McpServerSecrets, McpServerSetting};
pub use traffic::TrafficInspector;
pub use types::{
   AcpAgentStatus, AcpOpenedSession, AcpSessionInfo, AcpSessionList, AgentConfig, AgentRuntime,
   AgentSource, RegistryAgentInfo, SessionConfigValue,
};

pub(super) type AcpConnection = agent_client_protocol::ConnectionTo<agent_client_protocol::Agent>;
