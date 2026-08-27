use crate::{
   RuntimeError, RuntimeStatus, downloader,
   runtime_version::{check_runtime_version, managed_runtime_dir},
};
use std::path::{Path, PathBuf};

/// Node.js version to download if system version is not available
pub const NODE_VERSION: &str = "24.19.0";

/// Minimum required Node.js version for LSP servers
pub const MIN_NODE_VERSION: (u32, u32, u32) = (24, 0, 0);

/// Manages Node.js runtime for running JS-based language servers
pub struct NodeRuntime {
   binary_path: PathBuf,
}

impl NodeRuntime {
   /// Get Node.js runtime, downloading if necessary
   ///
   /// Priority:
   /// 1. Check system PATH for Node.js >= 24.0.0
   /// 2. Check if Athas-managed Node.js exists
   /// 3. Download Node.js from nodejs.org
   pub async fn get_or_install(managed_root: Option<&Path>) -> Result<Self, RuntimeError> {
      // 1. Check system PATH
      if let Ok(runtime) = Self::detect_system().await {
         log::info!("Using system Node.js at {:?}", runtime.binary_path);
         return Ok(runtime);
      }

      // 2. Check if already downloaded
      let managed_dir = Self::get_managed_dir(managed_root)?;
      if let Ok(runtime) = Self::from_managed_path(&managed_dir) {
         log::info!("Using Athas-managed Node.js at {:?}", runtime.binary_path);
         return Ok(runtime);
      }

      // 3. Download and install
      log::info!("No suitable Node.js found, downloading v{}", NODE_VERSION);
      Self::download_and_install(managed_root).await
   }

   /// Get Node.js runtime, preferring an existing Athas-managed runtime over
   /// the user's PATH. This keeps app-launched language servers more stable
   /// across shells and machines while still avoiding a download when no
   /// managed runtime has been installed yet.
   pub async fn get_or_install_managed_first(
      managed_root: Option<&Path>,
   ) -> Result<Self, RuntimeError> {
      if let Some(root) = managed_root {
         let managed_dir = Self::get_managed_dir(Some(root))?;
         if let Ok(runtime) = Self::from_managed_path(&managed_dir) {
            log::info!("Using Athas-managed Node.js at {:?}", runtime.binary_path);
            return Ok(runtime);
         }
      }

      if let Ok(runtime) = Self::detect_system().await {
         log::info!("Using system Node.js at {:?}", runtime.binary_path);
         return Ok(runtime);
      }

      log::info!("No suitable Node.js found, downloading v{}", NODE_VERSION);
      Self::download_and_install(managed_root).await
   }

   /// Get runtime status without installing
   pub async fn get_status(managed_root: Option<&Path>) -> RuntimeStatus {
      // Check system first
      if Self::detect_system().await.is_ok() {
         return RuntimeStatus::SystemAvailable;
      }

      // Check managed installation
      if let Ok(managed_dir) = Self::get_managed_dir(managed_root)
         && Self::from_managed_path(&managed_dir).is_ok()
      {
         return RuntimeStatus::ManagedInstalled;
      }

      RuntimeStatus::NotInstalled
   }

   /// Get the Node.js version if installed
   pub async fn get_version(managed_root: Option<&Path>) -> Option<String> {
      if let Ok(runtime) = Self::get_or_install(managed_root).await
         && let Ok(version) = runtime.check_version().await
      {
         return Some(format!("{}.{}.{}", version.0, version.1, version.2));
      }
      None
   }

   /// Detect Node.js on system PATH
   async fn detect_system() -> Result<Self, RuntimeError> {
      let path = which::which("node").map_err(|_| RuntimeError::NotFound("node".to_string()))?;

      let runtime = Self { binary_path: path };

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
   fn from_managed_path(managed_dir: &std::path::Path) -> Result<Self, RuntimeError> {
      let binary_path = downloader::get_node_binary_path(managed_dir);

      if !binary_path.exists() {
         return Err(RuntimeError::NotFound(
            binary_path.to_string_lossy().to_string(),
         ));
      }

      Ok(Self { binary_path })
   }

   /// Download Node.js and install it
   async fn download_and_install(managed_root: Option<&Path>) -> Result<Self, RuntimeError> {
      let managed_dir = Self::get_managed_dir(managed_root)?;

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
   fn get_managed_dir(managed_root: Option<&Path>) -> Result<PathBuf, RuntimeError> {
      managed_runtime_dir(managed_root, "node")
   }

   /// Check Node.js version by running `node --version`
   async fn check_version(&self) -> Result<(u32, u32, u32), RuntimeError> {
      check_runtime_version(&self.binary_path, true)
   }

   /// Get the path to the Node.js binary
   pub fn binary_path(&self) -> &PathBuf {
      &self.binary_path
   }
}
