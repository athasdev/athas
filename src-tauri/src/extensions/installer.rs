use super::types::{DownloadInfo, ExtensionMetadata, InstallProgress, InstallStatus};
use anyhow::{Context, Result};
use std::{
   fs,
   path::{Path, PathBuf},
};
use tauri::{AppHandle, Emitter, Manager};

pub struct ExtensionInstaller {
   app_handle: AppHandle,
   extensions_dir: PathBuf,
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
      log::info!(
         "Downloading extension {} from {}",
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
      let bytes = response.bytes().await?;

      log::info!(
         "Downloaded {} bytes for extension {}",
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

      let checksum = sha256::digest(bytes.as_ref());
      if checksum != download_info.checksum {
         anyhow::bail!(
            "Checksum mismatch for extension {}: expected {}, got {}",
            extension_id,
            download_info.checksum,
            checksum
         );
      }

      log::info!("Checksum verified for extension {}", extension_id);

      // Save to temporary file
      let temp_dir = std::env::temp_dir();
      let temp_file = temp_dir.join(format!("{}.tar.gz", extension_id));
      fs::write(&temp_file, bytes)?;

      Ok(temp_file)
   }

   /// Extract extension archive
   async fn extract_extension(&self, extension_id: &str, archive_path: &Path) -> Result<PathBuf> {
      log::info!(
         "Extracting extension {} from {:?}",
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

      let extension_dir = self.extensions_dir.join(extension_id);

      // Remove old version if exists
      if extension_dir.exists() {
         fs::remove_dir_all(&extension_dir)?;
      }

      fs::create_dir_all(&extension_dir)?;

      // Extract tar.gz
      let tar_gz = fs::File::open(archive_path)?;
      let tar = flate2::read::GzDecoder::new(tar_gz);
      let mut archive = tar::Archive::new(tar);
      archive.unpack(&extension_dir)?;

      log::info!(
         "Extension {} extracted to {:?}",
         extension_id,
         extension_dir
      );

      // Clean up temporary file
      let _ = fs::remove_file(archive_path);

      Ok(extension_dir)
   }

   /// Install extension from download info
   pub async fn install_extension(
      &self,
      extension_id: String,
      download_info: DownloadInfo,
   ) -> Result<()> {
      log::info!("Installing extension {}", extension_id);

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
      let _ = self.extract_extension(&extension_id, &archive_path).await?;

      // Save metadata
      let metadata = ExtensionMetadata {
         id: extension_id.clone(),
         name: extension_id.clone(),
         version: "1.0.0".to_string(), // TODO: Get from manifest
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

      log::info!("Extension {} installed successfully", extension_id);
      Ok(())
   }

   /// Uninstall extension
   pub fn uninstall_extension(&self, extension_id: &str) -> Result<()> {
      log::info!("Uninstalling extension {}", extension_id);

      let extension_dir = self.extensions_dir.join(extension_id);
      if extension_dir.exists() {
         fs::remove_dir_all(&extension_dir)?;
         log::info!("Extension {} uninstalled successfully", extension_id);
      } else {
         log::warn!("Extension {} not found", extension_id);
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
      log::info!("Listing installed extensions");

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
