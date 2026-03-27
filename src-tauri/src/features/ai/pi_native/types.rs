use crate::features::acp::types::AcpRuntimeState;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiNativeSessionInfo {
   pub path: String,
   pub id: String,
   pub cwd: String,
   pub name: Option<String>,
   pub parent_session_path: Option<String>,
   pub created_at: String,
   pub modified_at: String,
   pub message_count: usize,
   pub first_message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiNativeTranscriptMessage {
   pub id: String,
   pub role: String,
   pub content: String,
   pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiNativeSlashCommand {
   pub name: String,
   pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiNativeModelInfo {
   pub provider: String,
   pub model_id: String,
   pub name: String,
   pub reasoning: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiNativeSessionMode {
   pub id: String,
   pub name: String,
   pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiNativeSessionModeState {
   pub current_mode_id: Option<String>,
   pub available_modes: Vec<PiNativeSessionMode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiNativeSessionSnapshot {
   pub runtime_state: AcpRuntimeState,
   pub slash_commands: Vec<PiNativeSlashCommand>,
   pub session_mode_state: PiNativeSessionModeState,
}
