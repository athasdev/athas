use super::types::{DownloadInfo, ExtensionMetadata, InstallProgress, InstallStatus};
use crate::runtime::AthasAppHandle as AppHandle;
use anyhow::{Context, Result};
use futures_util::StreamExt;
use serde::Deserialize;
use std::{
   fs,
   path::{Path, PathBuf},
   sync::atomic::{AtomicU64, Ordering},
};
use tauri::{Emitter, Manager};

/// Absolute upper bound for a single extension download. Mirrors the tool
/// installer's binary cap so a compromised distribution point cannot OOM the
/// backend by serving an unbounded body.
const MAX_EXTENSION_DOWNLOAD_BYTES: u64 = 512 * 1024 * 1024;

static STAGING_COUNTER: AtomicU64 = AtomicU64::new(0);

pub struct ExtensionInstaller {
   app_handle: AppHandle,
   extensions_dir: PathBuf,
}

#[derive(Deserialize)]
struct InstalledManifest {
   id: String,
   name: String,
   #[serde(rename = "displayName")]
   display_name: Option<String>,
   version: String,
}

pub fn validate_extension_id(extension_id: &str) -> Result<()> {
   if extension_id.is_empty() || extension_id.len() > 128 {
      anyhow::bail!("Invalid integration id length");
   }
   if extension_id.contains("..") || extension_id.contains('/') || extension_id.contains('\\') {
      anyhow::bail!("Invalid integration id path characters");
   }
   if !extension_id
      .chars()
      .all(|ch| ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-')
   {
      anyhow::bail!("Invalid integration id characters");
   }
   Ok(())
}

fn require_download_checksum(extension_id: &str, download_info: &DownloadInfo) -> Result<()> {
   if download_info.checksum.is_empty() {
      anyhow::bail!(
         "Refusing to install integration {} without a checksum",
         extension_id
      );
   }
   Ok(())
}

fn require_https_download_url(url: &str) -> Result<()> {
   if url.starts_with("https://") {
      return Ok(());
   }
   #[cfg(debug_assertions)]
   if url.starts_with("http://localhost:") || url.starts_with("http://127.0.0.1:") {
      return Ok(());
   }
   anyhow::bail!("Integration download URL must use HTTPS");
}

fn create_exclusive_staging_file(extension_id: &str, bytes: &[u8]) -> Result<PathBuf> {
   let temp_dir = std::env::temp_dir();
   for _ in 0..100 {
      let unique = STAGING_COUNTER.fetch_add(1, Ordering::Relaxed);
      let candidate = temp_dir.join(format!(
         ".{}-{}-{}.tar.gz",
         extension_id,
         std::process::id(),
         unique
      ));
      match std::fs::OpenOptions::new()
         .write(true)
         .create_new(true)
         .open(&candidate)
      {
         Ok(mut file) => {
            use std::io::Write;
            file.write_all(bytes)?;
            return Ok(candidate);
         }
         Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
         Err(error) => return Err(error.into()),
      }
   }
   anyhow::bail!(
      "Could not create a unique staging file for integration {}",
      extension_id
   );
}

impl ExtensionInstaller {
   pub fn new(app_handle: AppHandle) -> Result<Self> {
      let app_data_dir = app_handle
         .path()
         .app_data_dir()
         .context("Failed to get app data directory")?;

      let extensions_dir = app_data_dir.join("extensions");

      // Create extensions directory if it doesn't exist
      fs::create_dir_all(&extensions_dir)?;

      Ok(Self {
         app_handle,
         extensions_dir,
      })
   }

   /// Download extension from URL
   async fn download_extension(
      &self,
      extension_id: &str,
      download_info: &DownloadInfo,
   ) -> Result<PathBuf> {
      validate_extension_id(extension_id)?;
      require_download_checksum(extension_id, download_info)?;
      require_https_download_url(&download_info.url)?;

      log::info!(
         "Downloading integration {} from {}",
         extension_id,
         download_info.url
      );

      // Emit progress event
      let _ = self.app_handle.emit(
         "extension://install-progress",
         InstallProgress {
            extension_id: extension_id.to_string(),
            status: InstallStatus::Downloading,
            progress: 0.0,
            message: "Starting download...".to_string(),
         },
      );

      // Download the file
      let response = reqwest::get(&download_info.url).await?;
      if !response.status().is_success() {
         let status = response.status();
         let hint = if status == reqwest::StatusCode::NOT_FOUND {
            format!(
               ". The package URL is missing from the integrations CDN: {}. Deploy the package or \
                point Athas at a local extensions CDN.",
               download_info.url
            )
         } else {
            String::new()
         };

         anyhow::bail!("Failed to download integration {extension_id}: HTTP {status}{hint}");
      }
      // Stream the body with a hard cap so a compromised distribution
      // point cannot OOM the backend with an unbounded response.
      let mut limit = MAX_EXTENSION_DOWNLOAD_BYTES;
      if download_info.size > 0 {
         if download_info.size > MAX_EXTENSION_DOWNLOAD_BYTES {
            anyhow::bail!(
               "Integration {} declares an excessive size of {} bytes",
               extension_id,
               download_info.size
            );
         }
         limit = download_info.size;
      }
      if let Some(advertised) = response.content_length()
         && advertised > limit
      {
         anyhow::bail!(
            "Integration {} advertises {} bytes, above the {} byte limit",
            extension_id,
            advertised,
            limit
         );
      }
      let mut bytes = Vec::new();
      let mut stream = response.bytes_stream();
      while let Some(chunk) = stream.next().await {
         let chunk = chunk?;
         if bytes.len() as u64 + chunk.len() as u64 > limit {
            anyhow::bail!(
               "Integration {} exceeded the {} byte download limit",
               extension_id,
               limit
            );
         }
         bytes.extend_from_slice(&chunk);
      }

      if download_info.size > 0 && bytes.len() as u64 != download_info.size {
         anyhow::bail!(
            "Downloaded integration size mismatch for {}: expected {}, got {}",
            extension_id,
            download_info.size,
            bytes.len()
         );
      }

      log::info!(
         "Downloaded {} bytes for integration {}",
         bytes.len(),
         extension_id
      );

      // Verify checksum
      let _ = self.app_handle.emit(
         "extension://install-progress",
         InstallProgress {
            extension_id: extension_id.to_string(),
            status: InstallStatus::Verifying,
            progress: 0.9,
            message: "Verifying checksum...".to_string(),
         },
      );

      if download_info.checksum.is_empty() {
         anyhow::bail!(
            "Refusing to install integration {} without a checksum",
            extension_id
         );
      }
      let checksum = sha256::digest(bytes.as_slice());
      if checksum != download_info.checksum {
         anyhow::bail!(
            "Checksum mismatch for integration {}: expected {}, got {}",
            extension_id,
            download_info.checksum,
            checksum
         );
      }

      log::info!("Checksum verified for integration {}", extension_id);

      // Stage under an unpredictable, exclusively created name so a local
      // attacker cannot pre-plant a symlink at the staging path.
      let temp_file = create_exclusive_staging_file(extension_id, &bytes)?;

      Ok(temp_file)
   }

   /// Extract extension archive
   async fn extract_extension(&self, extension_id: &str, archive_path: &Path) -> Result<PathBuf> {
      validate_extension_id(extension_id)?;

      log::info!(
         "Extracting integration {} from {:?}",
         extension_id,
         archive_path
      );

      let _ = self.app_handle.emit(
         "extension://install-progress",
         InstallProgress {
            extension_id: extension_id.to_string(),
            status: InstallStatus::Extracting,
            progress: 0.95,
            message: "Extracting files...".to_string(),
         },
      );

      let extension_dir = self
         .extensions_dir
         .join(format!(".installing-{extension_id}"));
      if extension_dir.exists() {
         fs::remove_dir_all(&extension_dir)?;
      }
      fs::create_dir_all(&extension_dir)?;

      // Extract tar.gz
      let tar_gz = fs::File::open(archive_path)?;
      let tar = flate2::read::GzDecoder::new(tar_gz);
      let mut archive = tar::Archive::new(tar);
      for entry in archive.entries()? {
         let mut entry = entry?;
         let unpacked = entry.unpack_in(&extension_dir)?;
         if !unpacked {
            anyhow::bail!("Archive entry attempted to escape integration directory");
         }
      }

      log::info!(
         "Integration {} extracted to {:?}",
         extension_id,
         extension_dir
      );

      // Clean up temporary file
      let _ = fs::remove_file(archive_path);

      Ok(extension_dir)
   }

   fn commit_extension(&self, extension_id: &str, staged_dir: &Path) -> Result<()> {
      let extension_dir = self.extensions_dir.join(extension_id);
      let backup_dir = self
         .extensions_dir
         .join(format!(".previous-{extension_id}"));

      if !extension_dir.exists() && backup_dir.exists() {
         fs::rename(&backup_dir, &extension_dir)?;
      } else if backup_dir.exists() {
         fs::remove_dir_all(&backup_dir)?;
      }

      if extension_dir.exists() {
         fs::rename(&extension_dir, &backup_dir)?;
      }

      if let Err(error) = fs::rename(staged_dir, &extension_dir) {
         if backup_dir.exists() {
            let _ = fs::rename(&backup_dir, &extension_dir);
         }
         return Err(error.into());
      }

      if backup_dir.exists() {
         fs::remove_dir_all(backup_dir)?;
      }
      Ok(())
   }

   /// Install extension from download info
   pub async fn install_extension(
      &self,
      extension_id: String,
      download_info: DownloadInfo,
   ) -> Result<()> {
      validate_extension_id(&extension_id)?;

      log::info!("Installing integration {}", extension_id);

      // Emit initial progress
      let _ = self.app_handle.emit(
         "extension://install-progress",
         InstallProgress {
            extension_id: extension_id.clone(),
            status: InstallStatus::Downloading,
            progress: 0.0,
            message: "Starting installation...".to_string(),
         },
      );

      // Download the extension
      let archive_path = self
         .download_extension(&extension_id, &download_info)
         .await?;

      // Extract the extension
      let staged_dir = self.extract_extension(&extension_id, &archive_path).await?;
      let manifest_path = staged_dir.join("extension.json");
      let canonical_staged_dir = staged_dir.canonicalize()?;
      let canonical_manifest_path = match manifest_path.canonicalize() {
         Ok(path) if path.starts_with(&canonical_staged_dir) => path,
         Ok(_) => {
            fs::remove_dir_all(&staged_dir)?;
            anyhow::bail!("Integration manifest escaped its package directory");
         }
         Err(error) => {
            fs::remove_dir_all(&staged_dir)?;
            return Err(error).context("Integration package is missing extension.json");
         }
      };
      let manifest_bytes = match fs::read(&canonical_manifest_path)
         .with_context(|| format!("Integration package is missing {}", manifest_path.display()))
      {
         Ok(bytes) => bytes,
         Err(error) => {
            fs::remove_dir_all(&staged_dir)?;
            return Err(error);
         }
      };
      let manifest_result: Result<InstalledManifest> = serde_json::from_slice(&manifest_bytes)
         .context("Integration package contains an invalid manifest");
      let manifest = match manifest_result {
         Ok(manifest) => manifest,
         Err(error) => {
            fs::remove_dir_all(&staged_dir)?;
            return Err(error);
         }
      };
      if manifest.id != extension_id {
         fs::remove_dir_all(&staged_dir)?;
         anyhow::bail!(
            "Integration manifest id mismatch: expected {}, got {}",
            extension_id,
            manifest.id
         );
      }
      if manifest.name.trim().is_empty() || manifest.version.trim().is_empty() {
         fs::remove_dir_all(&staged_dir)?;
         anyhow::bail!("Integration manifest name and version must not be empty");
      }
      self.commit_extension(&extension_id, &staged_dir)?;

      // Save metadata
      let metadata = ExtensionMetadata {
         id: extension_id.clone(),
         name: manifest.display_name.unwrap_or(manifest.name),
         version: manifest.version,
         installed_at: chrono::Utc::now().to_rfc3339(),
         enabled: true,
      };

      self.save_extension_metadata(&metadata)?;

      // Emit completion
      let _ = self.app_handle.emit(
         "extension://install-progress",
         InstallProgress {
            extension_id: extension_id.clone(),
            status: InstallStatus::Completed,
            progress: 1.0,
            message: "Installation completed!".to_string(),
         },
      );

      log::info!("Integration {} installed successfully", extension_id);
      Ok(())
   }

   /// Uninstall extension
   pub fn uninstall_extension(&self, extension_id: &str) -> Result<()> {
      validate_extension_id(extension_id)?;

      log::info!("Uninstalling integration {}", extension_id);

      let extension_dir = self.extensions_dir.join(extension_id);
      if extension_dir.exists() {
         fs::remove_dir_all(&extension_dir)?;
         log::info!("Integration {} uninstalled successfully", extension_id);
      } else {
         log::warn!("Integration {} not found", extension_id);
      }

      // Remove metadata
      let metadata_file = self.extensions_dir.join(format!("{}.json", extension_id));
      if metadata_file.exists() {
         fs::remove_file(&metadata_file)?;
      }

      Ok(())
   }

   /// List installed extensions
   pub fn list_installed_extensions(&self) -> Result<Vec<ExtensionMetadata>> {
      let mut extensions = Vec::new();

      if !self.extensions_dir.exists() {
         return Ok(extensions);
      }

      for entry in fs::read_dir(&self.extensions_dir)? {
         let entry = entry?;
         let path = entry.path();

         if path.is_dir() {
            let extension_id = path.file_name().unwrap().to_string_lossy().to_string();
            if let Ok(metadata) = self.load_extension_metadata(&extension_id) {
               extensions.push(metadata);
            }
         }
      }

      Ok(extensions)
   }

   /// Save extension metadata
   fn save_extension_metadata(&self, metadata: &ExtensionMetadata) -> Result<()> {
      let metadata_file = self.extensions_dir.join(format!("{}.json", metadata.id));
      let json = serde_json::to_string_pretty(metadata)?;
      fs::write(metadata_file, json)?;
      Ok(())
   }

   /// Load extension metadata
   fn load_extension_metadata(&self, extension_id: &str) -> Result<ExtensionMetadata> {
      let metadata_file = self.extensions_dir.join(format!("{}.json", extension_id));
      let json = fs::read_to_string(metadata_file)?;
      let metadata = serde_json::from_str(&json)?;
      Ok(metadata)
   }

   /// Get extension directory path
   pub fn get_extension_dir(&self, extension_id: &str) -> PathBuf {
      self.extensions_dir.join(extension_id)
   }
}

#[cfg(test)]
mod tests {
   use super::validate_extension_id;

   #[test]
   fn validate_extension_id_accepts_safe_values() {
      assert!(validate_extension_id("language.typescript").is_ok());
      assert!(validate_extension_id("theme-dark_01").is_ok());
   }

   #[test]
   fn validate_extension_id_rejects_path_traversal() {
      assert!(validate_extension_id("../evil").is_err());
      assert!(validate_extension_id("evil/dir").is_err());
      assert!(validate_extension_id("evil\\dir").is_err());
   }

   #[test]
   fn validate_extension_id_rejects_invalid_characters() {
      assert!(validate_extension_id("evil$id").is_err());
      assert!(validate_extension_id("").is_err());
      assert!(validate_extension_id(&"a".repeat(129)).is_err());
   }
}
