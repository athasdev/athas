use athas_runtime::{BunRuntime, NodeRuntime, RuntimeManager, RuntimeStatus, RuntimeType};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn managed_runtime_root(app_handle: &AppHandle) -> Result<PathBuf, String> {
   app_handle
      .path()
      .app_data_dir()
      .map(|dir| dir.join("runtimes"))
      .map_err(|e| format!("Failed to resolve runtime directory: {}", e))
}

/// Ensure a runtime is available, downloading if necessary
///
/// Supports: "bun", "node", "python", "go", "rust"
#[tauri::command]
pub async fn ensure_runtime(app_handle: AppHandle, runtime_type: String) -> Result<String, String> {
   let rt = parse_runtime_type(&runtime_type)?;
   let managed_root = managed_runtime_root(&app_handle)?;
   let path = RuntimeManager::get_runtime(Some(&managed_root), rt)
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
   let managed_root = managed_runtime_root(&app_handle)?;
   Ok(RuntimeManager::get_status(Some(&managed_root), rt).await)
}

/// Get the version of an installed runtime
#[tauri::command]
pub async fn get_runtime_version(
   app_handle: AppHandle,
   runtime_type: String,
) -> Result<Option<String>, String> {
   let managed_root = managed_runtime_root(&app_handle)?;
   match runtime_type.as_str() {
      "bun" => Ok(BunRuntime::get_version(Some(&managed_root)).await),
      "node" => Ok(NodeRuntime::get_version(Some(&managed_root)).await),
      // For other runtimes, we don't track versions (system-provided)
      "python" | "go" | "rust" => Ok(None),
      _ => Err(format!("Unknown runtime type: {}", runtime_type)),
   }
}

/// Get a JavaScript runtime (prefers Bun, falls back to Node)
#[tauri::command]
pub async fn get_js_runtime(app_handle: AppHandle) -> Result<String, String> {
   let managed_root = managed_runtime_root(&app_handle)?;
   let path = RuntimeManager::get_js_runtime(Some(&managed_root))
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
   let managed_root = managed_runtime_root(&app_handle)?;

   statuses.insert(
      "bun".to_string(),
      RuntimeManager::get_status(Some(&managed_root), RuntimeType::Bun).await,
   );
   statuses.insert(
      "node".to_string(),
      RuntimeManager::get_status(Some(&managed_root), RuntimeType::Node).await,
   );
   statuses.insert(
      "python".to_string(),
      RuntimeManager::get_status(Some(&managed_root), RuntimeType::Python).await,
   );
   statuses.insert(
      "go".to_string(),
      RuntimeManager::get_status(Some(&managed_root), RuntimeType::Go).await,
   );
   statuses.insert(
      "rust".to_string(),
      RuntimeManager::get_status(Some(&managed_root), RuntimeType::Rust).await,
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
