use crate::features::runtime::types::RuntimeError;
use flate2::read::GzDecoder;
use std::{
   fs::{self, File},
   io::{self, Cursor},
   path::Path,
};
use tar::Archive;

/// Platform information for downloading correct binary
struct PlatformInfo {
   os: &'static str,
   arch: &'static str,
   extension: &'static str,
}

impl PlatformInfo {
   fn detect() -> Result<Self, RuntimeError> {
      let os = match std::env::consts::OS {
         "macos" => "darwin",
         "linux" => "linux",
         "windows" => "win",
         other => {
            return Err(RuntimeError::Other(format!("Unsupported OS: {}", other)));
         }
      };

      let arch = match std::env::consts::ARCH {
         "x86_64" => "x64",
         "aarch64" => "arm64",
         other => {
            return Err(RuntimeError::Other(format!(
               "Unsupported architecture: {}",
               other
            )));
         }
      };

      let extension = if cfg!(windows) { "zip" } else { "tar.gz" };

      Ok(Self {
         os,
         arch,
         extension,
      })
   }
}

/// Download Node.js for the current platform
pub async fn download_node(version: &str, target_dir: &Path) -> Result<(), RuntimeError> {
   let platform = PlatformInfo::detect()?;

   // Build filename: node-v22.5.1-darwin-arm64.tar.gz
   let filename = format!(
      "node-v{}-{}-{}.{}",
      version, platform.os, platform.arch, platform.extension
   );

   // Build URL: https://nodejs.org/dist/v22.5.1/node-v22.5.1-darwin-arm64.tar.gz
   let url = format!("https://nodejs.org/dist/v{}/{}", version, filename);

   log::info!("Downloading Node.js {} from {}", version, url);

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

   // Extract based on archive type
   if platform.extension == "zip" {
      extract_zip(&bytes, target_dir)?;
   } else {
      extract_tar_gz(&bytes, target_dir)?;
   }

   log::info!(
      "Node.js {} installed successfully to {:?}",
      version,
      target_dir
   );
   Ok(())
}

/// Extract a .tar.gz archive
fn extract_tar_gz(bytes: &[u8], target_dir: &Path) -> Result<(), RuntimeError> {
   let cursor = Cursor::new(bytes);
   let decoder = GzDecoder::new(cursor);
   let mut archive = Archive::new(decoder);

   // Extract all entries
   for entry in archive
      .entries()
      .map_err(|e| RuntimeError::ExtractionFailed(e.to_string()))?
   {
      let mut entry = entry.map_err(|e| RuntimeError::ExtractionFailed(e.to_string()))?;

      let path = entry
         .path()
         .map_err(|e| RuntimeError::ExtractionFailed(e.to_string()))?;

      // Skip the top-level directory (node-v22.5.1-darwin-arm64/)
      // and extract directly to target_dir
      let components: Vec<_> = path.components().collect();
      if components.len() <= 1 {
         continue; // Skip top-level directory entry
      }

      // Build relative path without the top-level directory
      let relative_path: std::path::PathBuf = components[1..].iter().collect();
      let dest_path = target_dir.join(&relative_path);

      // Create parent directories
      if let Some(parent) = dest_path.parent() {
         fs::create_dir_all(parent)?;
      }

      // Extract file
      if entry.header().entry_type().is_file() {
         let mut file = File::create(&dest_path)?;
         io::copy(&mut entry, &mut file)?;

         // Set executable permission on Unix
         #[cfg(unix)]
         {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(mode) = entry.header().mode() {
               let permissions = fs::Permissions::from_mode(mode);
               fs::set_permissions(&dest_path, permissions).ok();
            }
         }
      } else if entry.header().entry_type().is_dir() {
         fs::create_dir_all(&dest_path)?;
      }
   }

   Ok(())
}

/// Extract a .zip archive (Windows)
fn extract_zip(bytes: &[u8], target_dir: &Path) -> Result<(), RuntimeError> {
   let cursor = Cursor::new(bytes);
   let mut archive =
      zip::ZipArchive::new(cursor).map_err(|e| RuntimeError::ExtractionFailed(e.to_string()))?;

   for i in 0..archive.len() {
      let mut file = archive
         .by_index(i)
         .map_err(|e| RuntimeError::ExtractionFailed(e.to_string()))?;

      let outpath = match file.enclosed_name() {
         Some(path) => {
            // Skip the top-level directory
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

      // Set permissions on Unix
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

/// Get the expected Node.js binary path within the extracted directory
pub fn get_node_binary_path(base_dir: &Path) -> std::path::PathBuf {
   if cfg!(windows) {
      base_dir.join("node.exe")
   } else {
      base_dir.join("bin").join("node")
   }
}

/// Get the expected npm path within the extracted directory
#[allow(dead_code)]
pub fn get_npm_path(base_dir: &Path) -> std::path::PathBuf {
   if cfg!(windows) {
      base_dir
         .join("node_modules")
         .join("npm")
         .join("bin")
         .join("npm-cli.js")
   } else {
      base_dir.join("bin").join("npm")
   }
}
