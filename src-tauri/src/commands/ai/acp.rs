use crate::features::ai::{AcpAgentBridge, AcpAgentStatus, AgentConfig};
use serde::Deserialize;
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

pub type AcpBridgeState = Arc<Mutex<AcpAgentBridge>>;

#[derive(Deserialize)]
pub struct PermissionResponseArgs {
   #[serde(alias = "requestId")]
   request_id: String,
   approved: bool,
   #[serde(default)]
   cancelled: bool,
}

#[tauri::command]
pub async fn get_available_agents(
   bridge: State<'_, AcpBridgeState>,
) -> Result<Vec<AgentConfig>, String> {
   let mut bridge = bridge.lock().await;
   Ok(bridge.detect_agents())
}

#[tauri::command]
pub async fn start_acp_agent(
   bridge: State<'_, AcpBridgeState>,
   agent_id: String,
   workspace_path: Option<String>,
   session_id: Option<String>,
) -> Result<AcpAgentStatus, String> {
   let bridge = { bridge.lock().await.clone() };
   bridge
      .start_agent(&agent_id, workspace_path, session_id)
      .await
      .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn stop_acp_agent(bridge: State<'_, AcpBridgeState>) -> Result<AcpAgentStatus, String> {
   let bridge = { bridge.lock().await.clone() };
   bridge.stop_agent().await.map_err(|e| e.to_string())?;
   Ok(bridge.get_status().await)
}

#[tauri::command]
pub async fn send_acp_prompt(
   bridge: State<'_, AcpBridgeState>,
   prompt: String,
) -> Result<(), String> {
   let bridge = { bridge.lock().await.clone() };
   bridge.send_prompt(&prompt).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_acp_status(bridge: State<'_, AcpBridgeState>) -> Result<AcpAgentStatus, String> {
   let bridge = { bridge.lock().await.clone() };
   Ok(bridge.get_status().await)
}

#[tauri::command]
pub async fn respond_acp_permission(
   bridge: State<'_, AcpBridgeState>,
   args: PermissionResponseArgs,
) -> Result<(), String> {
   let bridge = { bridge.lock().await.clone() };
   bridge
      .respond_to_permission(args.request_id, args.approved, args.cancelled)
      .await
      .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_acp_session_mode(
   bridge: State<'_, AcpBridgeState>,
   mode_id: String,
) -> Result<(), String> {
   let bridge = { bridge.lock().await.clone() };
   bridge
      .set_session_mode(&mode_id)
      .await
      .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cancel_acp_prompt(bridge: State<'_, AcpBridgeState>) -> Result<(), String> {
   let bridge = { bridge.lock().await.clone() };
   bridge.cancel_prompt().await.map_err(|e| e.to_string())
}
