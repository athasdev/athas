use crate::features::runtime::{
   BunRuntime, NodeRuntime, RuntimeManager, RuntimeStatus, RuntimeType,
};
use tauri::AppHandle;

/// Ensure a runtime is available, downloading if necessary
///
/// Supports: "bun", "node", "python", "go", "rust"
#[tauri::command]
pub async fn ensure_runtime(app_handle: AppHandle, runtime_type: String) -> Result<String, String> {
   let rt = parse_runtime_type(&runtime_type)?;
   let path = RuntimeManager::get_runtime(&app_handle, rt)
      .await
      .map_err(|e| e.to_string())?;
   Ok(path.to_string_lossy().into())
}

/// Get the status of a runtime without installing
#[tauri::command]
pub async fn get_runtime_status(
   app_handle: AppHandle,
   runtime_type: String,
) -> Result<RuntimeStatus, String> {
   let rt = parse_runtime_type(&runtime_type)?;
   Ok(RuntimeManager::get_status(&app_handle, rt).await)
}

/// Get the version of an installed runtime
#[tauri::command]
pub async fn get_runtime_version(
   app_handle: AppHandle,
   runtime_type: String,
) -> Result<Option<String>, String> {
   match runtime_type.as_str() {
      "bun" => Ok(BunRuntime::get_version(&app_handle).await),
      "node" => Ok(NodeRuntime::get_version(&app_handle).await),
      // For other runtimes, we don't track versions (system-provided)
      "python" | "go" | "rust" => Ok(None),
      _ => Err(format!("Unknown runtime type: {}", runtime_type)),
   }
}

/// Get a JavaScript runtime (prefers Bun, falls back to Node)
#[tauri::command]
pub async fn get_js_runtime(app_handle: AppHandle) -> Result<String, String> {
   let path = RuntimeManager::get_js_runtime(&app_handle)
      .await
      .map_err(|e| e.to_string())?;
   Ok(path.to_string_lossy().into())
}

/// Get status of all runtimes
#[tauri::command]
pub async fn get_all_runtime_statuses(
   app_handle: AppHandle,
) -> Result<std::collections::HashMap<String, RuntimeStatus>, String> {
   let mut statuses = std::collections::HashMap::new();

   statuses.insert(
      "bun".to_string(),
      RuntimeManager::get_status(&app_handle, RuntimeType::Bun).await,
   );
   statuses.insert(
      "node".to_string(),
      RuntimeManager::get_status(&app_handle, RuntimeType::Node).await,
   );
   statuses.insert(
      "python".to_string(),
      RuntimeManager::get_status(&app_handle, RuntimeType::Python).await,
   );
   statuses.insert(
      "go".to_string(),
      RuntimeManager::get_status(&app_handle, RuntimeType::Go).await,
   );
   statuses.insert(
      "rust".to_string(),
      RuntimeManager::get_status(&app_handle, RuntimeType::Rust).await,
   );

   Ok(statuses)
}

fn parse_runtime_type(s: &str) -> Result<RuntimeType, String> {
   match s {
      "bun" => Ok(RuntimeType::Bun),
      "node" => Ok(RuntimeType::Node),
      "python" => Ok(RuntimeType::Python),
      "go" => Ok(RuntimeType::Go),
      "rust" => Ok(RuntimeType::Rust),
      _ => Err(format!("Unknown runtime type: {}", s)),
   }
}
