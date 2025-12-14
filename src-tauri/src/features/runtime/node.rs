use crate::features::runtime::{
   downloader,
   types::{RuntimeError, RuntimeSource, RuntimeStatus},
};
use std::{path::PathBuf, process::Command};
use tauri::Manager;

/// Node.js version to download if system version is not available
pub const NODE_VERSION: &str = "22.5.1";

/// Minimum required Node.js version for LSP servers
pub const MIN_NODE_VERSION: (u32, u32, u32) = (22, 0, 0);

/// Manages Node.js runtime for running JS-based language servers
pub struct NodeRuntime {
   binary_path: PathBuf,
   #[allow(dead_code)]
   source: RuntimeSource,
}

impl NodeRuntime {
   /// Get Node.js runtime, downloading if necessary
   ///
   /// Priority:
   /// 1. Check system PATH for Node.js >= 22.0.0
   /// 2. Check if Athas-managed Node.js exists
   /// 3. Download Node.js from nodejs.org
   pub async fn get_or_install(app_handle: &tauri::AppHandle) -> Result<Self, RuntimeError> {
      // 1. Check system PATH
      if let Ok(runtime) = Self::detect_system().await {
         log::info!("Using system Node.js at {:?}", runtime.binary_path);
         return Ok(runtime);
      }

      // 2. Check if already downloaded
      let managed_dir = Self::get_managed_dir(app_handle)?;
      if let Ok(runtime) = Self::from_managed_path(&managed_dir) {
         log::info!("Using Athas-managed Node.js at {:?}", runtime.binary_path);
         return Ok(runtime);
      }

      // 3. Download and install
      log::info!("No suitable Node.js found, downloading v{}", NODE_VERSION);
      Self::download_and_install(app_handle).await
   }

   /// Get runtime status without installing
   pub async fn get_status(app_handle: &tauri::AppHandle) -> RuntimeStatus {
      // Check system first
      if Self::detect_system().await.is_ok() {
         return RuntimeStatus::SystemAvailable;
      }

      // Check managed installation
      if let Ok(managed_dir) = Self::get_managed_dir(app_handle) {
         if Self::from_managed_path(&managed_dir).is_ok() {
            return RuntimeStatus::ManagedInstalled;
         }
      }

      RuntimeStatus::NotInstalled
   }

   /// Get the Node.js version if installed
   pub async fn get_version(app_handle: &tauri::AppHandle) -> Option<String> {
      if let Ok(runtime) = Self::get_or_install(app_handle).await {
         if let Ok(version) = runtime.check_version().await {
            return Some(format!("{}.{}.{}", version.0, version.1, version.2));
         }
      }
      None
   }

   /// Detect Node.js on system PATH
   async fn detect_system() -> Result<Self, RuntimeError> {
      let path = which::which("node").map_err(|_| RuntimeError::NotFound("node".to_string()))?;

      let runtime = Self {
         binary_path: path,
         source: RuntimeSource::System,
      };

      // Check version
      let version = runtime.check_version().await?;
      if version < MIN_NODE_VERSION {
         return Err(RuntimeError::VersionTooOld {
            found: format!("{}.{}.{}", version.0, version.1, version.2),
            minimum: format!(
               "{}.{}.{}",
               MIN_NODE_VERSION.0, MIN_NODE_VERSION.1, MIN_NODE_VERSION.2
            ),
         });
      }

      Ok(runtime)
   }

   /// Create runtime from managed installation path
   fn from_managed_path(managed_dir: &PathBuf) -> Result<Self, RuntimeError> {
      let binary_path = downloader::get_node_binary_path(managed_dir);

      if !binary_path.exists() {
         return Err(RuntimeError::NotFound(
            binary_path.to_string_lossy().to_string(),
         ));
      }

      Ok(Self {
         binary_path,
         source: RuntimeSource::Managed,
      })
   }

   /// Download Node.js and install it
   async fn download_and_install(app_handle: &tauri::AppHandle) -> Result<Self, RuntimeError> {
      let managed_dir = Self::get_managed_dir(app_handle)?;

      // Remove existing installation if present
      if managed_dir.exists() {
         std::fs::remove_dir_all(&managed_dir).ok();
      }

      // Download and extract
      downloader::download_node(NODE_VERSION, &managed_dir).await?;

      // Return the new runtime
      Self::from_managed_path(&managed_dir)
   }

   /// Get the directory where managed Node.js is stored
   fn get_managed_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, RuntimeError> {
      let data_dir = app_handle
         .path()
         .app_data_dir()
         .map_err(|e| RuntimeError::PathError(e.to_string()))?;

      Ok(data_dir.join("runtimes").join("node"))
   }

   /// Check Node.js version by running `node --version`
   async fn check_version(&self) -> Result<(u32, u32, u32), RuntimeError> {
      let output = Command::new(&self.binary_path)
         .arg("--version")
         .output()
         .map_err(|e| RuntimeError::VersionCheckFailed(e.to_string()))?;

      if !output.status.success() {
         return Err(RuntimeError::VersionCheckFailed(
            String::from_utf8_lossy(&output.stderr).to_string(),
         ));
      }

      let version_str = String::from_utf8_lossy(&output.stdout);
      Self::parse_version(&version_str)
   }

   /// Parse version string like "v22.5.1" into (22, 5, 1)
   fn parse_version(version_str: &str) -> Result<(u32, u32, u32), RuntimeError> {
      let trimmed = version_str.trim().trim_start_matches('v');

      let parts: Vec<&str> = trimmed.split('.').collect();
      if parts.len() < 3 {
         return Err(RuntimeError::VersionCheckFailed(format!(
            "Invalid version format: {}",
            version_str
         )));
      }

      let major = parts[0]
         .parse()
         .map_err(|_| RuntimeError::VersionCheckFailed(format!("Invalid major: {}", parts[0])))?;
      let minor = parts[1]
         .parse()
         .map_err(|_| RuntimeError::VersionCheckFailed(format!("Invalid minor: {}", parts[1])))?;
      let patch = parts[2]
         .split(|c: char| !c.is_ascii_digit())
         .next()
         .unwrap_or("0")
         .parse()
         .map_err(|_| RuntimeError::VersionCheckFailed(format!("Invalid patch: {}", parts[2])))?;

      Ok((major, minor, patch))
   }

   /// Get the path to the Node.js binary
   pub fn binary_path(&self) -> &PathBuf {
      &self.binary_path
   }

   /// Get the source of this runtime
   #[allow(dead_code)]
   pub fn source(&self) -> &RuntimeSource {
      &self.source
   }
}

#[cfg(test)]
mod tests {
   use super::*;

   #[test]
   fn test_parse_version() {
      assert_eq!(NodeRuntime::parse_version("v22.5.1").unwrap(), (22, 5, 1));
      assert_eq!(NodeRuntime::parse_version("22.5.1").unwrap(), (22, 5, 1));
      assert_eq!(
         NodeRuntime::parse_version("v22.5.1-rc.1").unwrap(),
         (22, 5, 1)
      );
   }
}
