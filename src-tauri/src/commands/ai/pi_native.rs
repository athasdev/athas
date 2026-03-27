use crate::features::ai::{
   AcpAgentStatus, AcpBootstrapContext, PiNativeBridge, PiNativeSessionInfo,
   PiNativeSessionModeState, PiNativeSlashCommand, PiNativeTranscriptMessage,
};
use serde_json::Value;
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

pub type PiNativeBridgeState = Arc<Mutex<PiNativeBridge>>;

#[tauri::command]
pub async fn start_pi_native_session(
   bridge: State<'_, PiNativeBridgeState>,
   workspace_path: Option<String>,
   session_path: Option<String>,
   bootstrap: Option<AcpBootstrapContext>,
   route_key: Option<String>,
) -> Result<AcpAgentStatus, String> {
   let bridge = { bridge.lock().await.clone() };
   bridge
      .start_session(
         route_key.as_deref().unwrap_or("panel"),
         workspace_path,
         session_path,
         bootstrap,
      )
      .await
      .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn send_pi_native_prompt(
   bridge: State<'_, PiNativeBridgeState>,
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
pub async fn get_pi_native_status(
   bridge: State<'_, PiNativeBridgeState>,
   route_key: Option<String>,
) -> Result<AcpAgentStatus, String> {
   let bridge = { bridge.lock().await.clone() };
   bridge
      .get_status(route_key.as_deref().unwrap_or("panel"))
      .await
      .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_pi_native_sessions(
   bridge: State<'_, PiNativeBridgeState>,
   workspace_path: Option<String>,
) -> Result<Vec<PiNativeSessionInfo>, String> {
   let bridge = { bridge.lock().await.clone() };
   bridge
      .list_sessions(workspace_path)
      .await
      .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_pi_native_commands(
   bridge: State<'_, PiNativeBridgeState>,
   route_key: Option<String>,
) -> Result<Vec<PiNativeSlashCommand>, String> {
   let bridge = { bridge.lock().await.clone() };
   bridge
      .list_commands(route_key.as_deref().unwrap_or("panel"))
      .await
      .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_pi_native_settings_snapshot(
   bridge: State<'_, PiNativeBridgeState>,
   workspace_path: Option<String>,
) -> Result<Value, String> {
   let bridge = { bridge.lock().await.clone() };
   bridge
      .get_settings_snapshot(workspace_path)
      .await
      .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_pi_native_scoped_defaults(
   bridge: State<'_, PiNativeBridgeState>,
   workspace_path: Option<String>,
   scope: String,
   default_provider: Option<String>,
   default_model: Option<String>,
   default_thinking_level: Option<String>,
) -> Result<Value, String> {
   let bridge = { bridge.lock().await.clone() };
   bridge
      .set_defaults(
         workspace_path,
         &scope,
         default_provider,
         default_model,
         default_thinking_level,
      )
      .await
      .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_pi_native_api_key_credential(
   bridge: State<'_, PiNativeBridgeState>,
   workspace_path: Option<String>,
   provider_id: String,
   key: String,
) -> Result<Value, String> {
   let bridge = { bridge.lock().await.clone() };
   bridge
      .set_api_key_credential(workspace_path, &provider_id, &key)
      .await
      .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_pi_native_auth_credential(
   bridge: State<'_, PiNativeBridgeState>,
   workspace_path: Option<String>,
   provider_id: String,
) -> Result<Value, String> {
   let bridge = { bridge.lock().await.clone() };
   bridge
      .clear_auth_credential(workspace_path, &provider_id)
      .await
      .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn login_pi_native_provider(
   bridge: State<'_, PiNativeBridgeState>,
   workspace_path: Option<String>,
   provider_id: String,
) -> Result<Value, String> {
   let bridge = { bridge.lock().await.clone() };
   bridge
      .login_provider(workspace_path, &provider_id)
      .await
      .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn logout_pi_native_provider(
   bridge: State<'_, PiNativeBridgeState>,
   workspace_path: Option<String>,
   provider_id: String,
) -> Result<Value, String> {
   let bridge = { bridge.lock().await.clone() };
   bridge
      .logout_provider(workspace_path, &provider_id)
      .await
      .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn respond_pi_native_auth_prompt(
   bridge: State<'_, PiNativeBridgeState>,
   request_id: String,
   value: Option<String>,
   cancelled: bool,
) -> Result<(), String> {
   let bridge = { bridge.lock().await.clone() };
   bridge
      .respond_auth_prompt(&request_id, value, cancelled)
      .await
      .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn install_pi_native_package(
   bridge: State<'_, PiNativeBridgeState>,
   workspace_path: Option<String>,
   scope: String,
   source: String,
) -> Result<Value, String> {
   let bridge = { bridge.lock().await.clone() };
   bridge
      .install_package(workspace_path, &scope, &source)
      .await
      .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_pi_native_package(
   bridge: State<'_, PiNativeBridgeState>,
   workspace_path: Option<String>,
   scope: String,
   source: String,
) -> Result<Value, String> {
   let bridge = { bridge.lock().await.clone() };
   bridge
      .remove_package(workspace_path, &scope, &source)
      .await
      .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_pi_native_session_transcript(
   bridge: State<'_, PiNativeBridgeState>,
   session_path: String,
) -> Result<Vec<PiNativeTranscriptMessage>, String> {
   let bridge = { bridge.lock().await.clone() };
   bridge
      .get_session_transcript(session_path)
      .await
      .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn change_pi_native_mode(
   bridge: State<'_, PiNativeBridgeState>,
   mode_id: String,
   route_key: Option<String>,
) -> Result<PiNativeSessionModeState, String> {
   let bridge = { bridge.lock().await.clone() };
   bridge
      .change_mode(route_key.as_deref().unwrap_or("panel"), &mode_id)
      .await
      .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn stop_pi_native_session(
   bridge: State<'_, PiNativeBridgeState>,
   route_key: Option<String>,
) -> Result<AcpAgentStatus, String> {
   let bridge = { bridge.lock().await.clone() };
   bridge
      .stop_session(route_key.as_deref().unwrap_or("panel"))
      .await
      .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cancel_pi_native_prompt(
   bridge: State<'_, PiNativeBridgeState>,
   route_key: Option<String>,
) -> Result<(), String> {
   let bridge = { bridge.lock().await.clone() };
   bridge
      .cancel_prompt(route_key.as_deref().unwrap_or("panel"))
      .await
      .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn respond_pi_native_permission(
   bridge: State<'_, PiNativeBridgeState>,
   request_id: String,
   approved: bool,
   cancelled: bool,
   value: Option<String>,
   route_key: Option<String>,
) -> Result<(), String> {
   let bridge = { bridge.lock().await.clone() };
   bridge
      .respond_permission(
         route_key.as_deref().unwrap_or("panel"),
         &request_id,
         approved,
         cancelled,
         value,
      )
      .await
      .map_err(|e| e.to_string())
}
