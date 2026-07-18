mod bun;
mod downloader;
mod node;
pub mod process;

pub use bun::BunRuntime;
pub use node::NodeRuntime;
use serde::{Deserialize, Serialize};
use std::{
   env, fmt,
   path::{Path, PathBuf},
};

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
   pub async fn get_js_runtime(managed_root: Option<&Path>) -> Result<PathBuf, RuntimeError> {
      if let Ok(bun) = BunRuntime::get_or_install(managed_root).await {
         log::info!("Using Bun as JS runtime");
         return Ok(bun.binary_path().clone());
      }

      if let Ok(node) = NodeRuntime::get_or_install(managed_root).await {
         log::info!("Falling back to Node.js as JS runtime");
         return Ok(node.binary_path().clone());
      }

      Err(RuntimeError::NotFound(
         "No JavaScript runtime (Bun or Node.js) available".to_string(),
      ))
   }

   /// Get runtime by type
   pub async fn get_runtime(
      managed_root: Option<&Path>,
      runtime_type: RuntimeType,
   ) -> Result<PathBuf, RuntimeError> {
      match runtime_type {
         RuntimeType::Bun => {
            let runtime = BunRuntime::get_or_install(managed_root).await?;
            Ok(runtime.binary_path().clone())
         }
         RuntimeType::Node => {
            let runtime = NodeRuntime::get_or_install(managed_root).await?;
            Ok(runtime.binary_path().clone())
         }
         RuntimeType::Python => Self::detect_python(),
         RuntimeType::Go => Self::detect_go(),
         RuntimeType::Rust => Self::detect_rust(),
      }
   }

   /// Get runtime status by type
   pub async fn get_status(
      managed_root: Option<&Path>,
      runtime_type: RuntimeType,
   ) -> RuntimeStatus {
      match runtime_type {
         RuntimeType::Bun => BunRuntime::get_status(managed_root).await,
         RuntimeType::Node => NodeRuntime::get_status(managed_root).await,
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
      if let Some(path) = find_binary_in_dirs("python3", common_system_binary_dirs()) {
         return Ok(path);
      }
      if let Some(path) = find_binary_in_dirs("python", common_system_binary_dirs()) {
         return Ok(path);
      }
      Err(RuntimeError::NotFound("python".to_string()))
   }

   fn detect_go() -> Result<PathBuf, RuntimeError> {
      Self::detect_go_from_sources(
         which::which("go").ok(),
         env::var("GOROOT").ok(),
         common_system_binary_dirs(),
      )
   }

   fn detect_go_from_sources(
      path_go: Option<PathBuf>,
      goroot: Option<String>,
      common_dirs: Vec<PathBuf>,
   ) -> Result<PathBuf, RuntimeError> {
      if let Some(path) = path_go {
         return Ok(path);
      }

      if let Some(goroot) = goroot {
         let go_path = PathBuf::from(goroot).join("bin").join("go");
         if go_path.exists() {
            return Ok(go_path);
         }
      }

      if let Some(path) = find_binary_in_dirs("go", common_dirs) {
         return Ok(path);
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
      if let Ok(home) = env::var("HOME") {
         let cargo_path = PathBuf::from(home).join(".cargo").join("bin").join("cargo");
         if cargo_path.exists() {
            return Ok(cargo_path);
         }
      }
      if let Some(path) = find_binary_in_dirs("cargo", common_system_binary_dirs()) {
         return Ok(path);
      }
      Err(RuntimeError::NotFound("cargo".to_string()))
   }
}

fn find_binary_in_dirs(
   binary_name: &str,
   dirs: impl IntoIterator<Item = PathBuf>,
) -> Option<PathBuf> {
   let binary_name = platform_binary_name(binary_name);

   dirs
      .into_iter()
      .map(|dir| dir.join(&binary_name))
      .find(|path| path.exists())
}

fn platform_binary_name(binary_name: &str) -> String {
   if cfg!(windows) && !binary_name.ends_with(".exe") {
      format!("{}.exe", binary_name)
   } else {
      binary_name.to_string()
   }
}

fn common_system_binary_dirs() -> Vec<PathBuf> {
   let mut dirs = Vec::new();

   if cfg!(target_os = "macos") {
      dirs.extend([
         PathBuf::from("/opt/homebrew/bin"),
         PathBuf::from("/usr/local/bin"),
         PathBuf::from("/opt/local/bin"),
      ]);
   }

   if cfg!(not(windows)) {
      dirs.extend([PathBuf::from("/usr/bin"), PathBuf::from("/bin")]);
   }

   dirs
}

#[cfg(test)]
mod tests {
   use super::*;

   #[test]
   fn finds_binary_in_candidate_dirs() {
      let temp = tempfile::tempdir().expect("tempdir");
      let bin_dir = temp.path().join("bin");
      std::fs::create_dir_all(&bin_dir).expect("bin dir");
      let binary_path = bin_dir.join(platform_binary_name("go"));
      std::fs::write(&binary_path, "").expect("binary");

      assert_eq!(find_binary_in_dirs("go", [bin_dir]), Some(binary_path));
   }

   #[test]
   fn misses_binary_outside_candidate_dirs() {
      let temp = tempfile::tempdir().expect("tempdir");

      assert_eq!(
         find_binary_in_dirs("go", [temp.path().join("missing")]),
         None
      );
   }

   #[test]
   #[cfg(target_os = "macos")]
   fn common_system_dirs_include_homebrew_locations() {
      let dirs = common_system_binary_dirs();

      assert!(dirs.iter().any(|dir| dir == Path::new("/opt/homebrew/bin")));
      assert!(dirs.iter().any(|dir| dir == Path::new("/usr/local/bin")));
   }

   #[test]
   #[cfg(target_os = "macos")]
   fn detects_go_from_common_system_dirs_when_path_and_goroot_miss() {
      let temp = tempfile::tempdir().expect("tempdir");
      let bin_dir = temp.path().join("bin");
      std::fs::create_dir_all(&bin_dir).expect("bin dir");
      let go_path = bin_dir.join(platform_binary_name("go"));
      std::fs::write(&go_path, "").expect("go binary");

      let detected =
         RuntimeManager::detect_go_from_sources(None, None, vec![bin_dir]).expect("go fallback");

      assert_eq!(detected, go_path);
   }

   #[test]
   #[cfg(target_os = "macos")]
   fn common_system_dirs_find_homebrew_go_when_available() {
      let homebrew_go = Path::new("/opt/homebrew/bin/go");
      if !homebrew_go.exists() {
         return;
      }

      assert_eq!(
         find_binary_in_dirs("go", common_system_binary_dirs()).as_deref(),
         Some(homebrew_go)
      );
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

impl std::error::Error for RuntimeError {
}

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
