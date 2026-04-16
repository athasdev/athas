use crate::RuntimeError;
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

/// Extract a .tar.gz archive into `target_dir`, stripping the single top-level
/// directory that Node.js distribution tarballs wrap their contents in.
///
/// Uses `tar::Entry::unpack_in` so the archiver rejects any entry whose path
/// would escape the staging directory, guarding against tar-slip if the archive
/// is tampered with in transit or at the origin.
fn extract_tar_gz(bytes: &[u8], target_dir: &Path) -> Result<(), RuntimeError> {
   // Stage extraction in a temp directory so we can safely strip the top-level
   // `node-v*/` wrapper after `unpack_in` has validated each entry.
   let staging = tempfile::tempdir().map_err(|e| {
      RuntimeError::ExtractionFailed(format!("Failed to create staging dir: {}", e))
   })?;
   let staging_path = staging.path();

   let cursor = Cursor::new(bytes);
   let decoder = GzDecoder::new(cursor);
   let mut archive = Archive::new(decoder);

   for entry in archive
      .entries()
      .map_err(|e| RuntimeError::ExtractionFailed(e.to_string()))?
   {
      let mut entry = entry.map_err(|e| RuntimeError::ExtractionFailed(e.to_string()))?;
      let unpacked = entry
         .unpack_in(staging_path)
         .map_err(|e| RuntimeError::ExtractionFailed(e.to_string()))?;
      if !unpacked {
         return Err(RuntimeError::ExtractionFailed(
            "Rejected archive entry with unsafe path".to_string(),
         ));
      }
   }

   fs::create_dir_all(target_dir)?;

   // Promote the single top-level directory into `target_dir`. If the archive
   // unexpectedly lacks a wrapping directory, fall back to copying everything.
   let mut staged_entries = fs::read_dir(staging_path)?
      .collect::<Result<Vec<_>, _>>()?
      .into_iter()
      .filter(|entry| entry.file_name() != std::ffi::OsString::from("pax_global_header"));

   let first = staged_entries.next();
   let second = staged_entries.next();

   match (first, second) {
      (Some(only), None) if only.file_type()?.is_dir() => {
         move_dir_contents(&only.path(), target_dir)?;
      }
      (Some(first), second) => {
         move_dir_entry(&first, target_dir)?;
         if let Some(second) = second {
            move_dir_entry(&second, target_dir)?;
         }
         for entry in staged_entries {
            move_dir_entry(&entry, target_dir)?;
         }
      }
      _ => {}
   }

   Ok(())
}

fn move_dir_entry(entry: &fs::DirEntry, target_dir: &Path) -> Result<(), RuntimeError> {
   let dest = target_dir.join(entry.file_name());
   let src = entry.path();
   if entry.file_type()?.is_dir() {
      fs::create_dir_all(&dest)?;
      move_dir_contents(&src, &dest)?;
   } else {
      if let Some(parent) = dest.parent() {
         fs::create_dir_all(parent)?;
      }
      fs::rename(&src, &dest).or_else(|_| fs::copy(&src, &dest).map(|_| ()))?;
   }
   Ok(())
}

fn move_dir_contents(src: &Path, dst: &Path) -> Result<(), RuntimeError> {
   for entry in fs::read_dir(src)? {
      let entry = entry?;
      let dest_path = dst.join(entry.file_name());
      let src_path = entry.path();
      if entry.file_type()?.is_dir() {
         fs::create_dir_all(&dest_path)?;
         move_dir_contents(&src_path, &dest_path)?;
      } else {
         if let Some(parent) = dest_path.parent() {
            fs::create_dir_all(parent)?;
         }
         // Prefer rename (cheap); fall back to copy for cross-device moves.
         fs::rename(&src_path, &dest_path)
            .or_else(|_| fs::copy(&src_path, &dest_path).map(|_| ()))?;
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

#[cfg(test)]
mod tests {
   use super::*;
   use flate2::{Compression, write::GzEncoder};
   use tar::{EntryType, Header};

   /// Build a tar.gz archive. Files are detected by trailing `/` (dir) vs. not.
   fn make_tar_gz(entries: &[(&str, &[u8])]) -> Vec<u8> {
      let gz = GzEncoder::new(Vec::new(), Compression::default());
      let mut builder = tar::Builder::new(gz);
      for (path, contents) in entries {
         let mut header = Header::new_gnu();
         header.set_mode(0o755);
         if path.ends_with('/') {
            header.set_entry_type(EntryType::Directory);
            header.set_size(0);
         } else {
            header.set_entry_type(EntryType::Regular);
            header.set_size(contents.len() as u64);
         }
         builder
            .append_data(&mut header, path, std::io::Cursor::new(*contents))
            .unwrap();
      }
      let gz = builder.into_inner().unwrap();
      gz.finish().unwrap()
   }

   /// Build a tar.gz implementing the classic two-step tar-slip:
   /// 1. A symlink inside the wrapper points to an arbitrary outside directory.
   /// 2. A subsequent file entry is written *through* that symlink.
   ///
   /// `unpack_in` must reject step 2 because the resolved destination escapes
   /// the staging directory.
   fn make_tarslip_symlink_archive(
      wrapper: &str,
      link_name: &str,
      link_target: &str,
      payload_name: &str,
      payload_contents: &[u8],
   ) -> Vec<u8> {
      let gz = GzEncoder::new(Vec::new(), Compression::default());
      let mut builder = tar::Builder::new(gz);

      // Wrapper directory.
      let mut dir_header = Header::new_gnu();
      dir_header.set_entry_type(EntryType::Directory);
      dir_header.set_mode(0o755);
      dir_header.set_size(0);
      builder
         .append_data(&mut dir_header, wrapper, std::io::Cursor::new(&[][..]))
         .unwrap();

      // Symlink whose target is outside the staging dir.
      let mut link_header = Header::new_gnu();
      link_header.set_entry_type(EntryType::Symlink);
      link_header.set_mode(0o777);
      link_header.set_size(0);
      link_header.set_link_name(link_target).unwrap();
      builder
         .append_data(
            &mut link_header,
            format!("{wrapper}{link_name}"),
            std::io::Cursor::new(&[][..]),
         )
         .unwrap();

      // Payload written *through* the symlink; should be blocked.
      let mut payload_header = Header::new_gnu();
      payload_header.set_entry_type(EntryType::Regular);
      payload_header.set_mode(0o644);
      payload_header.set_size(payload_contents.len() as u64);
      builder
         .append_data(
            &mut payload_header,
            format!("{wrapper}{link_name}/{payload_name}"),
            std::io::Cursor::new(payload_contents),
         )
         .unwrap();

      let gz = builder.into_inner().unwrap();
      gz.finish().unwrap()
   }

   #[test]
   fn extract_tar_gz_rejects_symlink_payload_tarslip() {
      // Set up an outside directory that already exists so the symlink is
      // resolvable.
      let outside = tempfile::tempdir().unwrap();
      let outside_marker = outside.path().join("pwned");
      assert!(!outside_marker.exists());

      let malicious = make_tarslip_symlink_archive(
         "node-v22.0.0-linux-x64/",
         "evil",
         outside.path().to_str().unwrap(),
         "pwned",
         b"escaped",
      );

      let staging = tempfile::tempdir().unwrap();
      let result = extract_tar_gz(&malicious, staging.path());
      assert!(
         result.is_err(),
         "tar-slip through symlink must be rejected, got: {:?}",
         result
      );
      assert!(
         !outside_marker.exists(),
         "payload must not have been written outside the staging directory"
      );
   }

   #[test]
   fn extract_tar_gz_strips_single_top_level_dir() {
      let archive = make_tar_gz(&[
         ("node-v22.0.0-linux-x64/", b""),
         ("node-v22.0.0-linux-x64/bin/", b""),
         ("node-v22.0.0-linux-x64/bin/node", b"#!/bin/sh\n"),
         ("node-v22.0.0-linux-x64/README.md", b"hello"),
      ]);

      let target = tempfile::tempdir().unwrap();
      extract_tar_gz(&archive, target.path()).expect("extraction should succeed");

      assert!(target.path().join("bin/node").exists());
      assert_eq!(
         std::fs::read(target.path().join("README.md")).unwrap(),
         b"hello"
      );
   }
}
