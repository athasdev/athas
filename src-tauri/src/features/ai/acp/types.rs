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
}

/// Content block types in ACP messages
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AcpContentBlock {
   Text { text: String },
   Image { data: String, media_type: String },
   Resource { uri: String, name: Option<String> },
}

/// Events emitted to the frontend via Tauri
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AcpEvent {
   /// Agent message content chunk
   ContentChunk {
      session_id: String,
      content: AcpContentBlock,
      is_complete: bool,
   },
   /// Tool use started
   ToolStart {
      session_id: String,
      tool_name: String,
      tool_id: String,
      input: serde_json::Value,
   },
   /// Tool use completed
   ToolComplete {
      session_id: String,
      tool_id: String,
      success: bool,
   },
   /// Permission request from agent
   PermissionRequest {
      request_id: String,
      permission_type: String,
      resource: String,
      description: String,
   },
   /// Session completed
   SessionComplete { session_id: String },
   /// Error occurred
   Error {
      session_id: Option<String>,
      error: String,
   },
   /// Agent status changed
   StatusChanged { status: AcpAgentStatus },
   /// Available slash commands updated
   SlashCommandsUpdate {
      session_id: String,
      commands: Vec<SlashCommand>,
   },
   /// Session mode state updated (full state with available modes)
   SessionModeUpdate {
      session_id: String,
      mode_state: SessionModeState,
   },
   /// Current session mode changed (only the current mode id)
   CurrentModeUpdate {
      session_id: String,
      current_mode_id: String,
   },
   /// Prompt turn completed with a stop reason
   PromptComplete {
      session_id: String,
      stop_reason: StopReason,
   },
}
