use crate::features::ai::{AcpAgentBridge, AcpAgentStatus, AcpBootstrapContext, AgentConfig};
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
   #[serde(default)]
   value: Option<String>,
   #[serde(alias = "routeKey")]
   route_key: Option<String>,
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
   fresh_session: Option<bool>,
   bootstrap: Option<AcpBootstrapContext>,
   route_key: Option<String>,
) -> Result<AcpAgentStatus, String> {
   let bridge = { bridge.lock().await.clone() };
   bridge
      .start_agent(
         route_key.as_deref().unwrap_or("panel"),
         &agent_id,
         workspace_path,
         session_id,
         fresh_session.unwrap_or(false),
         bootstrap,
      )
      .await
      .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn stop_acp_agent(
   bridge: State<'_, AcpBridgeState>,
   route_key: Option<String>,
) -> Result<AcpAgentStatus, String> {
   let bridge = { bridge.lock().await.clone() };
   let route_key = route_key.unwrap_or_else(|| "panel".to_string());
   bridge
      .stop_agent(&route_key)
      .await
      .map_err(|e| e.to_string())?;
   Ok(bridge.get_status(&route_key).await)
}

#[tauri::command]
pub async fn send_acp_prompt(
   bridge: State<'_, AcpBridgeState>,
   prompt: String,
   route_key: Option<String>,
) -> Result<(), String> {
   let bridge = { bridge.lock().await.clone() };
   bridge
      .send_prompt(route_key.as_deref().unwrap_or("panel"), &prompt)
      .await
      .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_acp_status(
   bridge: State<'_, AcpBridgeState>,
   route_key: Option<String>,
) -> Result<AcpAgentStatus, String> {
   let bridge = { bridge.lock().await.clone() };
   Ok(bridge
      .get_status(route_key.as_deref().unwrap_or("panel"))
      .await)
}

#[tauri::command]
pub async fn respond_acp_permission(
   bridge: State<'_, AcpBridgeState>,
   args: PermissionResponseArgs,
) -> Result<(), String> {
   let bridge = { bridge.lock().await.clone() };
   bridge
      .respond_to_permission(
         args.route_key.as_deref().unwrap_or("panel"),
         args.request_id,
         args.approved,
         args.cancelled,
         args.value,
      )
      .await
      .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_acp_session_mode(
   bridge: State<'_, AcpBridgeState>,
   mode_id: String,
   route_key: Option<String>,
) -> Result<(), String> {
   let bridge = { bridge.lock().await.clone() };
   bridge
      .set_session_mode(route_key.as_deref().unwrap_or("panel"), &mode_id)
      .await
      .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cancel_acp_prompt(
   bridge: State<'_, AcpBridgeState>,
   route_key: Option<String>,
) -> Result<(), String> {
   let bridge = { bridge.lock().await.clone() };
   bridge
      .cancel_prompt(route_key.as_deref().unwrap_or("panel"))
      .await
      .map_err(|e| e.to_string())
}
