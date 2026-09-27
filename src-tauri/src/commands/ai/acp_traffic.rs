//! Commands behind the ACP inspector: each agent process's recorded JSON-RPC and stderr lines.

use super::acp::AcpBridgeState;
use athas_ai::acp::{
   TrafficInspector,
   traffic::{TrafficBacklog, TrafficProcess},
};
use tauri::State;

async fn traffic(bridge: &State<'_, AcpBridgeState>) -> TrafficInspector {
   bridge.lock().await.traffic()
}

/// Every agent process with a traffic log, running ones first.
#[tauri::command]
pub async fn get_acp_traffic_processes(
   bridge: State<'_, AcpBridgeState>,
) -> Result<Vec<TrafficProcess>, String> {
   Ok(traffic(&bridge).await.processes())
}

/// The recorded lines and `initialize` exchange of one process.
#[tauri::command]
pub async fn get_acp_traffic(
   bridge: State<'_, AcpBridgeState>,
   process_key: String,
) -> Result<Option<TrafficBacklog>, String> {
   Ok(traffic(&bridge).await.backlog(&process_key))
}

/// Starts sending new lines as `acp-traffic` events while an inspector is open.
#[tauri::command]
pub async fn subscribe_acp_traffic(bridge: State<'_, AcpBridgeState>) -> Result<(), String> {
   traffic(&bridge).await.subscribe();
   Ok(())
}

/// Stops sending `acp-traffic` events once no inspector is open.
#[tauri::command]
pub async fn unsubscribe_acp_traffic(bridge: State<'_, AcpBridgeState>) -> Result<(), String> {
   traffic(&bridge).await.unsubscribe();
   Ok(())
}

/// Drops the recorded lines of one process.
#[tauri::command]
pub async fn clear_acp_traffic(
   bridge: State<'_, AcpBridgeState>,
   process_key: String,
) -> Result<(), String> {
   traffic(&bridge).await.clear(&process_key);
   Ok(())
}

/// Writes one process's log to `path` as JSON Lines.
#[tauri::command]
pub async fn export_acp_traffic(
   bridge: State<'_, AcpBridgeState>,
   process_key: String,
   path: String,
) -> Result<(), String> {
   let export = traffic(&bridge)
      .await
      .export(&process_key)
      .ok_or_else(|| "This agent process has no traffic log".to_string())?;
   tokio::fs::write(&path, export)
      .await
      .map_err(|error| format!("Failed to write {path}: {error}"))
}
