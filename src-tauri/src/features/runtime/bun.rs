use super::types::{RuntimeError, RuntimeSource, RuntimeStatus};
use std::{
   fs::{self, File},
   io::{self, Cursor},
   path::{Path, PathBuf},
   process::Command,
};
use tauri::Manager;

/// Bun version to download if system version is not available
pub const BUN_VERSION: &str = "1.1.42";

/// Minimum required Bun version
pub const MIN_BUN_VERSION: (u32, u32, u32) = (1, 0, 0);

/// Manages Bun runtime for running JS-based language servers
pub struct BunRuntime {
   binary_path: PathBuf,
   #[allow(dead_code)]
   source: RuntimeSource,
}

impl BunRuntime {
   /// Get Bun runtime, downloading if necessary
   ///
   /// Priority:
   /// 1. Check system PATH for Bun >= 1.0.0
   /// 2. Check if Athas-managed Bun exists
   /// 3. Download Bun from GitHub releases
   pub async fn get_or_install(app_handle: &tauri::AppHandle) -> Result<Self, RuntimeError> {
      // 1. Check system PATH
      if let Ok(runtime) = Self::detect_system().await {
         log::info!("Using system Bun at {:?}", runtime.binary_path);
         return Ok(runtime);
      }

      // 2. Check if already downloaded
      let managed_dir = Self::get_managed_dir(app_handle)?;
      if let Ok(runtime) = Self::from_managed_path(&managed_dir) {
         log::info!("Using Athas-managed Bun at {:?}", runtime.binary_path);
         return Ok(runtime);
      }

      // 3. Download and install
      log::info!("No suitable Bun found, downloading v{}", BUN_VERSION);
      Self::download_and_install(app_handle).await
   }

   /// Get runtime status without installing
   pub async fn get_status(app_handle: &tauri::AppHandle) -> RuntimeStatus {
      // Check system first
      if Self::detect_system().await.is_ok() {
         return RuntimeStatus::SystemAvailable;
      }

      // Check managed installation
      if let Ok(managed_dir) = Self::get_managed_dir(app_handle)
         && Self::from_managed_path(&managed_dir).is_ok()
      {
         return RuntimeStatus::ManagedInstalled;
      }

      RuntimeStatus::NotInstalled
   }

   /// Get the Bun version if installed
   pub async fn get_version(app_handle: &tauri::AppHandle) -> Option<String> {
      if let Ok(runtime) = Self::get_or_install(app_handle).await
         && let Ok(version) = runtime.check_version().await
      {
         return Some(format!("{}.{}.{}", version.0, version.1, version.2));
      }
      None
   }

   /// Detect Bun on system PATH
   async fn detect_system() -> Result<Self, RuntimeError> {
      let path = which::which("bun").map_err(|_| RuntimeError::NotFound("bun".to_string()))?;

      let runtime = Self {
         binary_path: path,
         source: RuntimeSource::System,
      };

      // Check version
      let version = runtime.check_version().await?;
      if version < MIN_BUN_VERSION {
         return Err(RuntimeError::VersionTooOld {
            found: format!("{}.{}.{}", version.0, version.1, version.2),
            minimum: format!(
               "{}.{}.{}",
               MIN_BUN_VERSION.0, MIN_BUN_VERSION.1, MIN_BUN_VERSION.2
            ),
         });
      }

      Ok(runtime)
   }

   /// Create runtime from managed installation path
   fn from_managed_path(managed_dir: &std::path::Path) -> Result<Self, RuntimeError> {
      let binary_path = get_bun_binary_path(managed_dir);

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

   /// Download Bun and install it
   async fn download_and_install(app_handle: &tauri::AppHandle) -> Result<Self, RuntimeError> {
      let managed_dir = Self::get_managed_dir(app_handle)?;

      // Remove existing installation if present
      if managed_dir.exists() {
         std::fs::remove_dir_all(&managed_dir).ok();
      }

      // Download and extract
      download_bun(BUN_VERSION, &managed_dir).await?;

      // Return the new runtime
      Self::from_managed_path(&managed_dir)
   }

   /// Get the directory where managed Bun is stored
   fn get_managed_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, RuntimeError> {
      let data_dir = app_handle
         .path()
         .app_data_dir()
         .map_err(|e| RuntimeError::PathError(e.to_string()))?;

      Ok(data_dir.join("runtimes").join("bun"))
   }

   /// Check Bun version by running `bun --version`
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

   /// Parse version string like "1.1.42" into (1, 1, 42)
   fn parse_version(version_str: &str) -> Result<(u32, u32, u32), RuntimeError> {
      let trimmed = version_str.trim();

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

   /// Get the path to the Bun binary
   pub fn binary_path(&self) -> &PathBuf {
      &self.binary_path
   }

   /// Get the source of this runtime
   #[allow(dead_code)]
   pub fn source(&self) -> &RuntimeSource {
      &self.source
   }
}

/// Platform information for downloading correct Bun binary
struct BunPlatformInfo {
   os: &'static str,
   arch: &'static str,
}

impl BunPlatformInfo {
   fn detect() -> Result<Self, RuntimeError> {
      let os = match std::env::consts::OS {
         "macos" => "darwin",
         "linux" => "linux",
         "windows" => "windows",
         other => {
            return Err(RuntimeError::Other(format!("Unsupported OS: {}", other)));
         }
      };

      let arch = match std::env::consts::ARCH {
         "x86_64" => "x64",
         "aarch64" => "aarch64",
         other => {
            return Err(RuntimeError::Other(format!(
               "Unsupported architecture: {}",
               other
            )));
         }
      };

      Ok(Self { os, arch })
   }
}

/// Download Bun for the current platform
async fn download_bun(version: &str, target_dir: &Path) -> Result<(), RuntimeError> {
   let platform = BunPlatformInfo::detect()?;

   // Build filename: bun-darwin-aarch64.zip or bun-linux-x64.zip
   let filename = format!("bun-{}-{}.zip", platform.os, platform.arch);

   // Build URL: https://github.com/oven-sh/bun/releases/download/bun-v1.1.42/bun-darwin-aarch64.zip
   let url = format!(
      "https://github.com/oven-sh/bun/releases/download/bun-v{}/{}",
      version, filename
   );

   log::info!("Downloading Bun {} from {}", version, url);

   // Download the file
   let response = reqwest::get(&url)
      .await
      .map_err(|e| RuntimeError::DownloadFailed(e.to_string()))?;

   if !response.status().is_success() {
      return Err(RuntimeError::DownloadFailed(format!(
         "HTTP {} for {}",
         response.status(),
         url
      )));
   }

   let bytes = response
      .bytes()
      .await
      .map_err(|e| RuntimeError::DownloadFailed(e.to_string()))?;

   log::info!(
      "Downloaded {} bytes, extracting to {:?}",
      bytes.len(),
      target_dir
   );

   // Create target directory
   fs::create_dir_all(target_dir)?;

   // Bun is always distributed as a zip
   extract_bun_zip(&bytes, target_dir)?;

   log::info!("Bun {} installed successfully to {:?}", version, target_dir);
   Ok(())
}

/// Extract Bun zip archive
fn extract_bun_zip(bytes: &[u8], target_dir: &Path) -> Result<(), RuntimeError> {
   let cursor = Cursor::new(bytes);
   let mut archive =
      zip::ZipArchive::new(cursor).map_err(|e| RuntimeError::ExtractionFailed(e.to_string()))?;

   for i in 0..archive.len() {
      let mut file = archive
         .by_index(i)
         .map_err(|e| RuntimeError::ExtractionFailed(e.to_string()))?;

      let outpath = match file.enclosed_name() {
         Some(path) => {
            // Bun zip has structure: bun-darwin-aarch64/bun
            // We want to extract to: target_dir/bun
            let components: Vec<_> = path.components().collect();
            if components.len() <= 1 {
               continue;
            }
            let relative_path: std::path::PathBuf = components[1..].iter().collect();
            target_dir.join(relative_path)
         }
         None => continue,
      };

      if file.is_dir() {
         fs::create_dir_all(&outpath)?;
      } else {
         if let Some(parent) = outpath.parent() {
            fs::create_dir_all(parent)?;
         }
         let mut outfile = File::create(&outpath)?;
         io::copy(&mut file, &mut outfile)?;
      }

      // Set executable permissions on Unix
      #[cfg(unix)]
      {
         use std::os::unix::fs::PermissionsExt;
         if let Some(mode) = file.unix_mode() {
            fs::set_permissions(&outpath, fs::Permissions::from_mode(mode)).ok();
         }
      }
   }

   Ok(())
}

/// Get the expected Bun binary path within the extracted directory
pub fn get_bun_binary_path(base_dir: &Path) -> PathBuf {
   if cfg!(windows) {
      base_dir.join("bun.exe")
   } else {
      base_dir.join("bun")
   }
}

#[cfg(test)]
mod tests {
   use super::*;

   #[test]
   fn test_parse_version() {
      assert_eq!(BunRuntime::parse_version("1.1.42").unwrap(), (1, 1, 42));
      assert_eq!(BunRuntime::parse_version("1.0.0").unwrap(), (1, 0, 0));
      assert_eq!(BunRuntime::parse_version("1.1.42\n").unwrap(), (1, 1, 42));
   }
}
