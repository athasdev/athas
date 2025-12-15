use crate::features::runtime::{NodeRuntime, RuntimeStatus};
use tauri::AppHandle;

/// Ensure a runtime is available, downloading if necessary
///
/// Currently supports: "node"
#[tauri::command]
pub async fn ensure_runtime(app_handle: AppHandle, runtime_type: String) -> Result<String, String> {
   match runtime_type.as_str() {
      "node" => {
         let runtime = NodeRuntime::get_or_install(&app_handle)
            .await
            .map_err(|e| e.to_string())?;
         Ok(runtime.binary_path().to_string_lossy().into())
      }
      _ => Err(format!("Unknown runtime type: {}", runtime_type)),
   }
}

/// Get the status of a runtime without installing
#[tauri::command]
pub async fn get_runtime_status(
   app_handle: AppHandle,
   runtime_type: String,
) -> Result<RuntimeStatus, String> {
   match runtime_type.as_str() {
      "node" => Ok(NodeRuntime::get_status(&app_handle).await),
      _ => Err(format!("Unknown runtime type: {}", runtime_type)),
   }
}

/// Get the version of an installed runtime
#[tauri::command]
pub async fn get_runtime_version(
   app_handle: AppHandle,
   runtime_type: String,
) -> Result<Option<String>, String> {
   match runtime_type.as_str() {
      "node" => Ok(NodeRuntime::get_version(&app_handle).await),
      _ => Err(format!("Unknown runtime type: {}", runtime_type)),
   }
}
