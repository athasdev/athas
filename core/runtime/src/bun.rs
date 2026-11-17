use crate::{
   RuntimeError, RuntimeStatus,
   downloader::{download_bytes, extract_wrapped_zip},
   runtime_version::{check_runtime_version, managed_runtime_dir, parse_runtime_version},
};
use sha2::{Digest, Sha256};
use std::{
   fs,
   path::{Path, PathBuf},
};

/// Bun version to download if system version is not available
pub const BUN_VERSION: &str = "1.3.14";

/// Minimum required Bun version
pub const MIN_BUN_VERSION: (u32, u32, u32) = (1, 3, 14);

/// Manages Bun runtime for running JS-based language servers
pub struct BunRuntime {
   binary_path: PathBuf,
}

impl BunRuntime {
   /// Get Bun runtime, downloading if necessary
   ///
   /// Priority:
   /// 1. Check system PATH for a compatible Bun
   /// 2. Check if Athas-managed Bun is compatible
   /// 3. Download Bun from GitHub releases
   pub async fn get_or_install(managed_root: Option<&Path>) -> Result<Self, RuntimeError> {
      // 1. Check system PATH
      if let Ok(runtime) = Self::detect_system().await {
         log::info!("Using system Bun at {:?}", runtime.binary_path);
         return Ok(runtime);
      }

      // 2. Check if already downloaded
      let managed_dir = Self::get_managed_dir(managed_root)?;
      if let Ok(runtime) = Self::from_managed_path(&managed_dir) {
         match runtime.check_version().await {
            Ok(version) if version >= MIN_BUN_VERSION => {
               log::info!("Using Athas-managed Bun at {:?}", runtime.binary_path);
               return Ok(runtime);
            }
            Ok(version) => {
               log::info!(
                  "Athas-managed Bun {}.{}.{} is below required version {}, upgrading",
                  version.0,
                  version.1,
                  version.2,
                  BUN_VERSION
               );
            }
            Err(error) => {
               log::warn!(
                  "Athas-managed Bun could not be validated and will be reinstalled: {}",
                  error
               );
            }
         }
      }

      // 3. Download and install
      log::info!("No suitable Bun found, downloading v{}", BUN_VERSION);
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
         && let Ok(runtime) = Self::from_managed_path(&managed_dir)
         && let Ok(version) = runtime.check_version().await
         && version >= MIN_BUN_VERSION
      {
         return RuntimeStatus::ManagedInstalled;
      }

      RuntimeStatus::NotInstalled
   }

   /// Get the Bun version if installed
   pub async fn get_version(managed_root: Option<&Path>) -> Option<String> {
      if let Ok(runtime) = Self::get_or_install(managed_root).await
         && let Ok(version) = runtime.check_version().await
      {
         return Some(format!("{}.{}.{}", version.0, version.1, version.2));
      }
      None
   }

   /// Detect Bun on system PATH
   async fn detect_system() -> Result<Self, RuntimeError> {
      let path = which::which("bun").map_err(|_| RuntimeError::NotFound("bun".to_string()))?;

      let runtime = Self { binary_path: path };

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

      Ok(Self { binary_path })
   }

   /// Download Bun and install it
   async fn download_and_install(managed_root: Option<&Path>) -> Result<Self, RuntimeError> {
      let managed_dir = Self::get_managed_dir(managed_root)?;
      let managed_parent = managed_dir.parent().ok_or_else(|| {
         RuntimeError::PathError("managed Bun directory has no parent".to_string())
      })?;
      fs::create_dir_all(managed_parent)?;

      let staging = tempfile::Builder::new()
         .prefix(".bun-install-")
         .tempdir_in(managed_parent)
         .map_err(|error| RuntimeError::ExtractionFailed(error.to_string()))?;

      download_bun(BUN_VERSION, staging.path()).await?;

      let staged_runtime = Self::from_managed_path(staging.path())?;
      let staged_version = staged_runtime.check_version().await?;
      let expected_version = parse_runtime_version(BUN_VERSION, false)?;
      if staged_version != expected_version {
         return Err(RuntimeError::VersionCheckFailed(format!(
            "Downloaded Bun reported {}.{}.{} instead of {}",
            staged_version.0, staged_version.1, staged_version.2, BUN_VERSION
         )));
      }

      let staging_path = staging.keep();
      if managed_dir.exists() {
         fs::remove_dir_all(&managed_dir)?;
      }
      if let Err(error) = fs::rename(&staging_path, &managed_dir) {
         fs::remove_dir_all(&staging_path).ok();
         return Err(RuntimeError::IoError(error));
      }

      Self::from_managed_path(&managed_dir)
   }

   /// Get the directory where managed Bun is stored
   fn get_managed_dir(managed_root: Option<&Path>) -> Result<PathBuf, RuntimeError> {
      managed_runtime_dir(managed_root, "bun")
   }

   /// Check Bun version by running `bun --version`
   async fn check_version(&self) -> Result<(u32, u32, u32), RuntimeError> {
      check_runtime_version(&self.binary_path, false)
   }

   /// Get the path to the Bun binary
   pub fn binary_path(&self) -> &PathBuf {
      &self.binary_path
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

   // Build URL: https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/bun-darwin-aarch64.zip
   let url = format!(
      "https://github.com/oven-sh/bun/releases/download/bun-v{}/{}",
      version, filename
   );

   log::info!("Downloading Bun {} from {}", version, url);

   // Download the file
   let bytes = download_bytes(&url).await?;

   let expected_sha256 = bun_asset_sha256(version, &filename).ok_or_else(|| {
      RuntimeError::DownloadFailed(format!(
         "No SHA-256 checksum configured for Bun {} asset {}",
         version, filename
      ))
   })?;
   verify_sha256(&bytes, expected_sha256)?;

   log::info!(
      "Downloaded {} bytes, extracting to {:?}",
      bytes.len(),
      target_dir
   );

   // Create target directory
   fs::create_dir_all(target_dir)?;

   // Bun is always distributed as a zip
   extract_wrapped_zip(&bytes, target_dir)?;

   log::info!("Bun {} installed successfully to {:?}", version, target_dir);
   Ok(())
}

fn bun_asset_sha256(version: &str, filename: &str) -> Option<&'static str> {
   if version != BUN_VERSION {
      return None;
   }

   match filename {
      "bun-darwin-aarch64.zip" => {
         Some("d8b96221828ad6f97ac7ac0ab7e95872341af763001e8803e8267652c2652620")
      }
      "bun-darwin-x64.zip" => {
         Some("4183df3374623e5bab315c547cfa0974533cd457d86b73b639f7a87974cd6633")
      }
      "bun-linux-aarch64.zip" => {
         Some("a27ffb63a8310375836e0d6f668ae17fa8d8d18b88c37c821c65331973a19a3b")
      }
      "bun-linux-x64.zip" => {
         Some("951ee2aee855f08595aeec6225226a298d3fea83a3dcd6465c09cbccdf7e848f")
      }
      "bun-windows-aarch64.zip" => {
         Some("89841f5a57f2348b67ec0839b718f4bf4ea7d07c371c9ba4b77b6c790f918953")
      }
      "bun-windows-x64.zip" => {
         Some("0a0620930b6675d7ba440e81f4e0e00d3cfbe096c4b140d3fff02205e9e18922")
      }
      _ => None,
   }
}

fn verify_sha256(bytes: &[u8], expected: &str) -> Result<(), RuntimeError> {
   let actual = format!("{:x}", Sha256::digest(bytes));
   if actual != expected {
      return Err(RuntimeError::DownloadFailed(format!(
         "SHA-256 mismatch: expected {}, got {}",
         expected, actual
      )));
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
   fn has_checksums_for_supported_assets() {
      for filename in [
         "bun-darwin-aarch64.zip",
         "bun-darwin-x64.zip",
         "bun-linux-aarch64.zip",
         "bun-linux-x64.zip",
         "bun-windows-aarch64.zip",
         "bun-windows-x64.zip",
      ] {
         assert!(bun_asset_sha256(BUN_VERSION, filename).is_some());
      }
   }

   #[test]
   fn verifies_sha256_digest() {
      let digest = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

      assert!(verify_sha256(b"abc", digest).is_ok());
      assert!(verify_sha256(b"tampered", digest).is_err());
   }
}
