use athas_debugger::{DebugAdapterLaunch, DebugManager, DebugSessionInfo};
use serde_json::Value;
use tauri::{State, command};

#[command]
pub async fn debug_start_session(
   manager: State<'_, DebugManager>,
   launch: DebugAdapterLaunch,
) -> Result<DebugSessionInfo, String> {
   manager
      .start_session(launch)
      .map_err(|error| error.to_string())
}

#[command]
pub async fn debug_send_request(
   manager: State<'_, DebugManager>,
   session_id: String,
   command: String,
   arguments: Option<Value>,
) -> Result<u64, String> {
   manager
      .send_request(&session_id, command, arguments)
      .map_err(|error| error.to_string())
}

#[command]
pub async fn debug_send_raw_message(
   manager: State<'_, DebugManager>,
   session_id: String,
   message: Value,
) -> Result<(), String> {
   manager
      .send_raw_message(&session_id, message)
      .map_err(|error| error.to_string())
}

#[command]
pub async fn debug_stop_session(
   manager: State<'_, DebugManager>,
   session_id: String,
) -> Result<(), String> {
   manager
      .stop_session(&session_id)
      .map_err(|error| error.to_string())
}

#[command]
pub async fn debug_list_sessions(
   manager: State<'_, DebugManager>,
) -> Result<Vec<DebugSessionInfo>, String> {
   manager.list_sessions().map_err(|error| error.to_string())
}
