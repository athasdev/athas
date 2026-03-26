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

/// Runtime state cached for an agent session
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AcpRuntimeState {
   pub agent_id: String,
   pub source: Option<String>,
   pub session_id: Option<String>,
   pub session_path: Option<String>,
   pub workspace_path: Option<String>,
   pub provider: Option<String>,
   pub model_id: Option<String>,
   pub thinking_level: Option<String>,
   pub behavior: Option<String>,
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
   pub session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapMessage {
   pub role: String,
   pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AcpBootstrapContext {
   pub conversation_history: Vec<BootstrapMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpToolLocation {
   pub path: String,
   pub line: Option<u32>,
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

/// Events emitted to the frontend via Tauri
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AcpEvent {
   /// User message content chunk
   #[serde(rename_all = "camelCase")]
   UserMessageChunk {
      route_key: String,
      session_id: String,
      content: AcpContentBlock,
      is_complete: bool,
   },
   /// Agent message content chunk
   #[serde(rename_all = "camelCase")]
   ContentChunk {
      route_key: String,
      session_id: String,
      content: AcpContentBlock,
      is_complete: bool,
   },
   /// Agent thought content chunk
   #[serde(rename_all = "camelCase")]
   ThoughtChunk {
      route_key: String,
      session_id: String,
      content: AcpContentBlock,
      is_complete: bool,
   },
   /// Tool use started
   #[serde(rename_all = "camelCase")]
   ToolStart {
      route_key: String,
      session_id: String,
      tool_name: String,
      tool_id: String,
      input: serde_json::Value,
   },
   /// Tool use completed
   #[serde(rename_all = "camelCase")]
   ToolComplete {
      route_key: String,
      session_id: String,
      tool_id: String,
      success: bool,
      output: Option<serde_json::Value>,
      locations: Option<Vec<AcpToolLocation>>,
   },
   /// Permission request from agent
   #[serde(rename_all = "camelCase")]
   PermissionRequest {
      route_key: String,
      request_id: String,
      permission_type: String,
      resource: String,
      description: String,
      title: Option<String>,
      placeholder: Option<String>,
      default_value: Option<String>,
      options: Option<Vec<String>>,
   },
   /// Session completed
   #[serde(rename_all = "camelCase")]
   SessionComplete {
      route_key: String,
      session_id: String,
   },
   /// Error occurred
   #[serde(rename_all = "camelCase")]
   Error {
      route_key: String,
      session_id: Option<String>,
      error: String,
   },
   /// Agent status changed
   #[serde(rename_all = "camelCase")]
   StatusChanged {
      route_key: String,
      status: AcpAgentStatus,
   },
   /// Available slash commands updated
   #[serde(rename_all = "camelCase")]
   SlashCommandsUpdate {
      route_key: String,
      session_id: String,
      commands: Vec<SlashCommand>,
   },
   /// Agent plan update
   #[serde(rename_all = "camelCase")]
   PlanUpdate {
      route_key: String,
      session_id: String,
      entries: Vec<AcpPlanEntry>,
   },
   /// Runtime/session metadata updated
   #[serde(rename_all = "camelCase")]
   RuntimeStateUpdate {
      route_key: String,
      session_id: Option<String>,
      runtime_state: AcpRuntimeState,
   },
   /// Session mode state updated (full state with available modes)
   #[serde(rename_all = "camelCase")]
   SessionModeUpdate {
      route_key: String,
      session_id: String,
      mode_state: SessionModeState,
   },
   /// Current session mode changed (only the current mode id)
   #[serde(rename_all = "camelCase")]
   CurrentModeUpdate {
      route_key: String,
      session_id: String,
      current_mode_id: String,
   },
   /// Prompt turn completed with a stop reason
   #[serde(rename_all = "camelCase")]
   PromptComplete {
      route_key: String,
      session_id: String,
      stop_reason: StopReason,
   },
   /// UI action request from agent
   #[serde(rename_all = "camelCase")]
   UiAction {
      route_key: String,
      session_id: String,
      action: UiAction,
   },
}

#[cfg(test)]
mod tests {
   use super::{AcpAgentStatus, AcpEvent};

   #[test]
   fn serializes_route_key_as_camel_case() {
      let event = AcpEvent::StatusChanged {
         route_key: "harness:session-1".to_string(),
         status: AcpAgentStatus::default(),
      };

      let value = serde_json::to_value(event).unwrap();
      assert_eq!(value["routeKey"], "harness:session-1");
      assert_eq!(value["type"], "status_changed");
   }

   #[test]
   fn serializes_permission_request_route_key() {
      let event = AcpEvent::PermissionRequest {
         route_key: "harness:session-2".to_string(),
         request_id: "req-1".to_string(),
         permission_type: "tool_call".to_string(),
         resource: "tool-1".to_string(),
         description: "Run tool".to_string(),
         title: None,
         placeholder: None,
         default_value: None,
         options: None,
      };

      let value = serde_json::to_value(event).unwrap();
      assert_eq!(value["routeKey"], "harness:session-2");
      assert_eq!(value["requestId"], "req-1");
   }
}
