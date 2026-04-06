use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Slash command input specification
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlashCommandInput {
   pub hint: String,
}

/// Available slash command from an ACP agent
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlashCommand {
   pub name: String,
   pub description: String,
   pub input: Option<SlashCommandInput>,
}

/// A session mode that an ACP agent can operate in
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMode {
   pub id: String,
   pub name: String,
   pub description: Option<String>,
}

/// State of available session modes and current mode
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionModeState {
   pub current_mode_id: Option<String>,
   pub available_modes: Vec<SessionMode>,
}

/// Runtime used to install and launch an ACP agent
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AgentRuntime {
   Node,
   Python,
   Go,
   Rust,
   Binary,
}

/// Reason why a prompt turn ended
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StopReason {
   /// The turn ended successfully
   EndTurn,
   /// The turn ended because the agent reached the maximum number of tokens
   MaxTokens,
   /// The turn ended because the agent reached the maximum number of requests
   MaxTurnRequests,
   /// The agent refused to continue
   Refusal,
   /// The turn was cancelled by the client
   Cancelled,
}

impl From<agent_client_protocol::StopReason> for StopReason {
   fn from(reason: agent_client_protocol::StopReason) -> Self {
      match reason {
         agent_client_protocol::StopReason::EndTurn => StopReason::EndTurn,
         agent_client_protocol::StopReason::MaxTokens => StopReason::MaxTokens,
         agent_client_protocol::StopReason::MaxTurnRequests => StopReason::MaxTurnRequests,
         agent_client_protocol::StopReason::Refusal => StopReason::Refusal,
         agent_client_protocol::StopReason::Cancelled => StopReason::Cancelled,
         _ => StopReason::EndTurn, // Default for unknown variants
      }
   }
}

/// Priority level for an ACP plan entry
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AcpPlanEntryPriority {
   High,
   Medium,
   Low,
}

/// Execution status for an ACP plan entry
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AcpPlanEntryStatus {
   Pending,
   InProgress,
   Completed,
}

/// A single plan entry streamed by ACP agents
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpPlanEntry {
   pub content: String,
   pub priority: AcpPlanEntryPriority,
   pub status: AcpPlanEntryStatus,
}

/// Configuration for an ACP-compatible agent
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfig {
   pub id: String,
   pub name: String,
   pub binary_name: String,
   pub binary_path: Option<String>,
   pub args: Vec<String>,
   pub env_vars: HashMap<String, String>,
   pub icon: Option<String>,
   pub description: Option<String>,
   pub installed: bool,
   pub install_runtime: Option<AgentRuntime>,
   pub install_package: Option<String>,
   pub install_command: Option<String>,
   pub can_install: bool,
}

impl AgentConfig {
   pub fn new(id: &str, name: &str, binary_name: &str) -> Self {
      Self {
         id: id.to_string(),
         name: name.to_string(),
         binary_name: binary_name.to_string(),
         binary_path: None,
         args: Vec::new(),
         env_vars: HashMap::new(),
         icon: None,
         description: None,
         installed: false,
         install_runtime: None,
         install_package: None,
         install_command: None,
         can_install: false,
      }
   }

   pub fn with_description(mut self, description: &str) -> Self {
      self.description = Some(description.to_string());
      self
   }

   pub fn with_args(mut self, args: Vec<&str>) -> Self {
      self.args = args.into_iter().map(|s| s.to_string()).collect();
      self
   }

   pub fn with_install(mut self, runtime: AgentRuntime, package: &str) -> Self {
      self.install_runtime = Some(runtime);
      self.install_package = Some(package.to_string());
      self.can_install = true;
      self
   }

   pub fn with_install_command(mut self, command: &str) -> Self {
      self.install_command = Some(command.to_string());
      self
   }
}

/// Status of an ACP agent connection
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub struct AcpAgentStatus {
   pub agent_id: String,
   pub running: bool,
   pub session_active: bool,
   pub initialized: bool,
   pub session_id: Option<String>,
}

/// Content block types in ACP messages
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AcpContentBlock {
   Text {
      text: String,
   },
   Image {
      data: String,
      #[serde(rename = "mediaType")]
      media_type: String,
   },
   Resource {
      uri: String,
      name: Option<String>,
   },
}

/// UI action types that agents can request
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum UiAction {
   /// Open a URL in the web viewer
   #[serde(rename_all = "camelCase")]
   OpenWebViewer { url: String },
   /// Open a terminal with an optional command
   #[serde(rename_all = "camelCase")]
   OpenTerminal { command: Option<String> },
}

/// A selectable value for an ACP session configuration option
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionConfigOptionValue {
   pub id: String,
   pub name: String,
   pub description: Option<String>,
}

/// Supported ACP session configuration option variants
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SessionConfigOptionKind {
   #[serde(rename_all = "camelCase")]
   Select {
      current_value: String,
      options: Vec<SessionConfigOptionValue>,
   },
}

/// ACP session configuration option advertised by the agent
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionConfigOption {
   pub id: String,
   pub name: String,
   pub description: Option<String>,
   pub kind: SessionConfigOptionKind,
}

/// Events emitted to the frontend via Tauri
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AcpEvent {
   /// User message content chunk
   #[serde(rename_all = "camelCase")]
   UserMessageChunk {
      session_id: String,
      content: AcpContentBlock,
      is_complete: bool,
   },
   /// Agent message content chunk
   #[serde(rename_all = "camelCase")]
   ContentChunk {
      session_id: String,
      content: AcpContentBlock,
      is_complete: bool,
   },
   /// Agent thought content chunk
   #[serde(rename_all = "camelCase")]
   ThoughtChunk {
      session_id: String,
      content: AcpContentBlock,
      is_complete: bool,
   },
   /// Tool use started
   #[serde(rename_all = "camelCase")]
   ToolStart {
      session_id: String,
      tool_name: String,
      tool_id: String,
      input: serde_json::Value,
   },
   /// Tool use completed
   #[serde(rename_all = "camelCase")]
   ToolComplete {
      session_id: String,
      tool_id: String,
      success: bool,
   },
   /// Permission request from agent
   #[serde(rename_all = "camelCase")]
   PermissionRequest {
      request_id: String,
      permission_type: String,
      resource: String,
      description: String,
   },
   /// Session completed
   #[serde(rename_all = "camelCase")]
   SessionComplete { session_id: String },
   /// Error occurred
   #[serde(rename_all = "camelCase")]
   Error {
      session_id: Option<String>,
      error: String,
   },
   /// Agent status changed
   #[serde(rename_all = "camelCase")]
   StatusChanged { status: AcpAgentStatus },
   /// Available slash commands updated
   #[serde(rename_all = "camelCase")]
   SlashCommandsUpdate {
      session_id: String,
      commands: Vec<SlashCommand>,
   },
   /// Agent plan update
   #[serde(rename_all = "camelCase")]
   PlanUpdate {
      session_id: String,
      entries: Vec<AcpPlanEntry>,
   },
   /// Session mode state updated (full state with available modes)
   #[serde(rename_all = "camelCase")]
   SessionModeUpdate {
      session_id: String,
      mode_state: SessionModeState,
   },
   /// Current session mode changed (only the current mode id)
   #[serde(rename_all = "camelCase")]
   CurrentModeUpdate {
      session_id: String,
      current_mode_id: String,
   },
   /// Session configuration options updated
   #[serde(rename_all = "camelCase")]
   ConfigOptionsUpdate {
      session_id: String,
      config_options: Vec<SessionConfigOption>,
   },
   /// Session metadata updated
   #[serde(rename_all = "camelCase")]
   SessionInfoUpdate {
      session_id: String,
      title: Option<String>,
      updated_at: Option<String>,
   },
   /// Prompt turn completed with a stop reason
   #[serde(rename_all = "camelCase")]
   PromptComplete {
      session_id: String,
      stop_reason: StopReason,
   },
   /// UI action request from agent
   #[serde(rename_all = "camelCase")]
   UiAction {
      session_id: String,
      action: UiAction,
   },
}
