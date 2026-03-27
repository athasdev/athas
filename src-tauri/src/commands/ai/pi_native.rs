use crate::features::ai::{
   AcpAgentStatus, AcpBootstrapContext, PiNativeBridge, PiNativeSessionInfo,
};
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
