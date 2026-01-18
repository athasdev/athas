mod bun;
mod downloader;
mod node;
mod types;

pub use bun::BunRuntime;
pub use node::NodeRuntime;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
pub use types::{RuntimeError, RuntimeStatus};

/// Supported runtime types
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RuntimeType {
   Bun,
   Node,
   Python,
   Go,
   Rust,
}

/// Unified runtime manager that handles multiple runtime types
pub struct RuntimeManager;

impl RuntimeManager {
   /// Get a JS runtime, preferring Bun over Node
   /// This is used for running JS-based tools like LSP servers
   pub async fn get_js_runtime(app_handle: &tauri::AppHandle) -> Result<PathBuf, RuntimeError> {
      // Try Bun first (faster startup)
      if let Ok(bun) = BunRuntime::get_or_install(app_handle).await {
         log::info!("Using Bun as JS runtime");
         return Ok(bun.binary_path().clone());
      }

      // Fall back to Node
      if let Ok(node) = NodeRuntime::get_or_install(app_handle).await {
         log::info!("Falling back to Node.js as JS runtime");
         return Ok(node.binary_path().clone());
      }

      Err(RuntimeError::NotFound(
         "No JavaScript runtime (Bun or Node.js) available".to_string(),
      ))
   }

   /// Get runtime by type
   pub async fn get_runtime(
      app_handle: &tauri::AppHandle,
      runtime_type: RuntimeType,
   ) -> Result<PathBuf, RuntimeError> {
      match runtime_type {
         RuntimeType::Bun => {
            let runtime = BunRuntime::get_or_install(app_handle).await?;
            Ok(runtime.binary_path().clone())
         }
         RuntimeType::Node => {
            let runtime = NodeRuntime::get_or_install(app_handle).await?;
            Ok(runtime.binary_path().clone())
         }
         RuntimeType::Python => Self::detect_python(),
         RuntimeType::Go => Self::detect_go(),
         RuntimeType::Rust => Self::detect_rust(),
      }
   }

   /// Get runtime status by type
   pub async fn get_status(
      app_handle: &tauri::AppHandle,
      runtime_type: RuntimeType,
   ) -> RuntimeStatus {
      match runtime_type {
         RuntimeType::Bun => BunRuntime::get_status(app_handle).await,
         RuntimeType::Node => NodeRuntime::get_status(app_handle).await,
         RuntimeType::Python => {
            if Self::detect_python().is_ok() {
               RuntimeStatus::SystemAvailable
            } else {
               RuntimeStatus::NotInstalled
            }
         }
         RuntimeType::Go => {
            if Self::detect_go().is_ok() {
               RuntimeStatus::SystemAvailable
            } else {
               RuntimeStatus::NotInstalled
            }
         }
         RuntimeType::Rust => {
            if Self::detect_rust().is_ok() {
               RuntimeStatus::SystemAvailable
            } else {
               RuntimeStatus::NotInstalled
            }
         }
      }
   }

   /// Detect Python on system
   fn detect_python() -> Result<PathBuf, RuntimeError> {
      // Try python3 first, then python
      if let Ok(path) = which::which("python3") {
         return Ok(path);
      }
      if let Ok(path) = which::which("python") {
         return Ok(path);
      }
      Err(RuntimeError::NotFound("python".to_string()))
   }

   /// Detect Go on system
   fn detect_go() -> Result<PathBuf, RuntimeError> {
      if let Ok(path) = which::which("go") {
         return Ok(path);
      }
      // Check GOROOT
      if let Ok(goroot) = std::env::var("GOROOT") {
         let go_path = PathBuf::from(goroot).join("bin").join("go");
         if go_path.exists() {
            return Ok(go_path);
         }
      }
      Err(RuntimeError::NotFound("go".to_string()))
   }

   /// Detect Rust toolchain on system
   fn detect_rust() -> Result<PathBuf, RuntimeError> {
      if let Ok(path) = which::which("cargo") {
         return Ok(path);
      }
      // Check CARGO_HOME
      if let Ok(cargo_home) = std::env::var("CARGO_HOME") {
         let cargo_path = PathBuf::from(cargo_home).join("bin").join("cargo");
         if cargo_path.exists() {
            return Ok(cargo_path);
         }
      }
      // Check default rustup location
      if let Ok(home) = std::env::var("HOME") {
         let cargo_path = PathBuf::from(home).join(".cargo").join("bin").join("cargo");
         if cargo_path.exists() {
            return Ok(cargo_path);
         }
      }
      Err(RuntimeError::NotFound("cargo".to_string()))
   }
}
