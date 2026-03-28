mod bun;
mod downloader;
mod node;

pub use bun::BunRuntime;
pub use node::NodeRuntime;
use serde::{Deserialize, Serialize};
use std::{fmt, path::PathBuf};

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
   pub async fn get_js_runtime(app_handle: &tauri::AppHandle) -> Result<PathBuf, RuntimeError> {
      if let Ok(bun) = BunRuntime::get_or_install(app_handle).await {
         log::info!("Using Bun as JS runtime");
         return Ok(bun.binary_path().clone());
      }

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

   fn detect_python() -> Result<PathBuf, RuntimeError> {
      if let Ok(path) = which::which("python3") {
         return Ok(path);
      }
      if let Ok(path) = which::which("python") {
         return Ok(path);
      }
      Err(RuntimeError::NotFound("python".to_string()))
   }

   fn detect_go() -> Result<PathBuf, RuntimeError> {
      if let Ok(path) = which::which("go") {
         return Ok(path);
      }
      if let Ok(goroot) = std::env::var("GOROOT") {
         let go_path = PathBuf::from(goroot).join("bin").join("go");
         if go_path.exists() {
            return Ok(go_path);
         }
      }
      Err(RuntimeError::NotFound("go".to_string()))
   }

   fn detect_rust() -> Result<PathBuf, RuntimeError> {
      if let Ok(path) = which::which("cargo") {
         return Ok(path);
      }
      if let Ok(cargo_home) = std::env::var("CARGO_HOME") {
         let cargo_path = PathBuf::from(cargo_home).join("bin").join("cargo");
         if cargo_path.exists() {
            return Ok(cargo_path);
         }
      }
      if let Ok(home) = std::env::var("HOME") {
         let cargo_path = PathBuf::from(home).join(".cargo").join("bin").join("cargo");
         if cargo_path.exists() {
            return Ok(cargo_path);
         }
      }
      Err(RuntimeError::NotFound("cargo".to_string()))
   }
}

/// Status of a runtime installation
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeStatus {
   /// Runtime is not installed and not available
   NotInstalled,
   /// Runtime is available on system PATH
   SystemAvailable,
   /// Runtime was downloaded and managed by Athas
   ManagedInstalled,
   /// Runtime path is configured by user in settings
   CustomConfigured,
}

/// Errors that can occur during runtime operations
#[derive(Debug)]
pub enum RuntimeError {
   /// Runtime not found on system PATH
   NotFound(String),
   /// Version is below minimum required
   VersionTooOld { found: String, minimum: String },
   /// Failed to check runtime version
   VersionCheckFailed(String),
   /// Download failed
   DownloadFailed(String),
   /// Extraction failed
   ExtractionFailed(String),
   /// IO error
   IoError(std::io::Error),
   /// Path error
   PathError(String),
   /// Other error
   Other(String),
}

impl fmt::Display for RuntimeError {
   fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
      match self {
         RuntimeError::NotFound(name) => write!(f, "Runtime '{}' not found on system", name),
         RuntimeError::VersionTooOld { found, minimum } => {
            write!(
               f,
               "Runtime version {} is below minimum required {}",
               found, minimum
            )
         }
         RuntimeError::VersionCheckFailed(msg) => {
            write!(f, "Failed to check runtime version: {}", msg)
         }
         RuntimeError::DownloadFailed(msg) => write!(f, "Download failed: {}", msg),
         RuntimeError::ExtractionFailed(msg) => write!(f, "Extraction failed: {}", msg),
         RuntimeError::IoError(e) => write!(f, "IO error: {}", e),
         RuntimeError::PathError(msg) => write!(f, "Path error: {}", msg),
         RuntimeError::Other(msg) => write!(f, "{}", msg),
      }
   }
}

impl std::error::Error for RuntimeError {}

impl From<std::io::Error> for RuntimeError {
   fn from(err: std::io::Error) -> Self {
      RuntimeError::IoError(err)
   }
}

impl From<RuntimeError> for String {
   fn from(err: RuntimeError) -> Self {
      err.to_string()
   }
}
