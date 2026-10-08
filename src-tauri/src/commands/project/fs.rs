use super::path_guard::{require_path_under_home, require_symlink_container_under_home};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs, path::Path, time::Instant};
#[cfg(target_os = "macos")]
use tauri::Manager;
use tauri::{AppHandle, command};
use walkdir::WalkDir;

/// Raw file contents. The webview receives an `ArrayBuffer` instead of a JSON
/// array with one number per byte.
pub struct FileBytes(pub(crate) Vec<u8>);

impl tauri::ipc::IpcResponse for FileBytes {
   fn body(self) -> tauri::Result<tauri::ipc::InvokeResponseBody> {
      Ok(tauri::ipc::InvokeResponseBody::Raw(self.0))
   }
}

impl specta::Type for FileBytes {
   fn definition(_: &mut specta::Types) -> specta::datatype::DataType {
      specta::datatype::DataType::Reference(specta_typescript::define("ArrayBuffer"))
   }
}

fn calculate_directory_size(path: &Path) -> Result<u64, String> {
   if !path.is_dir() {
      return Err("Path is not a directory".to_string());
   }

   let mut size = 0_u64;
   for entry in WalkDir::new(path).follow_links(false) {
      let Ok(entry) = entry else {
         continue;
      };
      if !entry.file_type().is_file() {
         continue;
      }
      let Ok(metadata) = entry.metadata() else {
         continue;
      };
      size = size.saturating_add(metadata.len());
   }

   Ok(size)
}

#[command]
#[specta::specta]
pub async fn get_local_directory_size(path: String) -> Result<u64, String> {
   tauri::async_runtime::spawn_blocking(move || {
      let resolved = require_path_under_home(&path)?;
      calculate_directory_size(&resolved)
   })
   .await
   .map_err(|error| format!("Directory size task failed: {error}"))?
}

#[command]
#[specta::specta]
pub async fn read_local_file(path: String) -> Result<FileBytes, String> {
   let short_path = Path::new(&path)
      .file_name()
      .and_then(|name| name.to_str())
      .unwrap_or(&path)
      .to_string();
   let started_at = Instant::now();
   let (bytes, queue_elapsed, guard_elapsed, read_elapsed) =
      tauri::async_runtime::spawn_blocking(move || {
         let worker_started_at = Instant::now();
         let guard_started_at = Instant::now();
         let resolved = require_path_under_home(&path)?;
         let guard_elapsed = guard_started_at.elapsed();
         let read_started_at = Instant::now();
         let bytes =
            fs::read(&resolved).map_err(|error| format!("Failed to read file: {error}"))?;
         Ok::<_, String>((
            bytes,
            worker_started_at.duration_since(started_at),
            guard_elapsed,
            read_started_at.elapsed(),
         ))
      })
      .await
      .map_err(|error| format!("File read task failed: {error}"))??;
   let elapsed = started_at.elapsed();

   if elapsed.as_millis() >= 50 {
      log::warn!(
         "[file-read] {} total={}ms queue={}ms guard={}ms read={}ms {} bytes",
         short_path,
         elapsed.as_millis(),
         queue_elapsed.as_millis(),
         guard_elapsed.as_millis(),
         read_elapsed.as_millis(),
         bytes.len()
      );
   } else if cfg!(debug_assertions) && elapsed.as_millis() >= 10 {
      log::info!(
         "[file-read] {} total={}ms queue={}ms guard={}ms read={}ms {} bytes",
         short_path,
         elapsed.as_millis(),
         queue_elapsed.as_millis(),
         guard_elapsed.as_millis(),
         read_elapsed.as_millis(),
         bytes.len()
      );
   }

   Ok(FileBytes(bytes))
}

#[command]
#[specta::specta]
pub async fn write_local_file(path: String, content: String) -> Result<(), String> {
   tauri::async_runtime::spawn_blocking(move || {
      let resolved = require_path_under_home(&path)?;
      athas_project::file_mutations::mutate_text(&resolved, None, |_| Ok(Some(content))).map(|_| ())
   })
   .await
   .map_err(|error| format!("File write failed: {error}"))?
}

/// The text a checked write expects on disk, sent as its UTF-8 length and SHA-256 instead of a
/// second full copy of the file.
#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExpectedFileDigest {
   pub byte_length: u32,
   pub sha256: String,
}

fn text_matches_digest(text: &str, expected: &ExpectedFileDigest) -> bool {
   text.len() == expected.byte_length as usize
      && format!("{:x}", Sha256::digest(text.as_bytes())) == expected.sha256
}

/// Mirrors `matches_expected`: a file that only adds a UTF-8 BOM still matches.
fn matches_expected_digest(current: Option<&str>, expected: Option<&ExpectedFileDigest>) -> bool {
   match (current, expected) {
      (Some(current), Some(expected)) => {
         text_matches_digest(current, expected)
            || current
               .strip_prefix('\u{feff}')
               .is_some_and(|text| text_matches_digest(text, expected))
      }
      (None, None) => true,
      _ => false,
   }
}

#[command]
#[specta::specta]
pub async fn write_local_file_checked(
   path: String,
   expected: Option<ExpectedFileDigest>,
   content: String,
) -> Result<(), String> {
   tauri::async_runtime::spawn_blocking(move || {
      let resolved = require_path_under_home(&path)?;
      let expected_length = expected
         .as_ref()
         .map_or(0, |digest| digest.byte_length as u64);
      athas_project::file_mutations::mutate_text(
         &resolved,
         Some(expected_length.max(content.len() as u64) + 3),
         |current| {
            if !matches_expected_digest(current, expected.as_ref()) {
               return Err(athas_project::file_mutations::FILE_CHANGED.into());
            }
            Ok(Some(content))
         },
      )
      .map(|_| ())
   })
   .await
   .map_err(|error| format!("Checked file write failed: {error}"))?
}

#[command]
#[specta::specta]
pub async fn delete_local_file_checked(
   path: String,
   expected_content: String,
) -> Result<(), String> {
   tauri::async_runtime::spawn_blocking(move || {
      let resolved = require_path_under_home(&path)?;
      athas_project::file_mutations::delete_text_if_unchanged(&resolved, &expected_content)
   })
   .await
   .map_err(|error| format!("Checked file deletion failed: {error}"))?
}

#[command]
#[specta::specta]
pub fn open_file_external(path: String) -> Result<(), String> {
   // Canonicalize and confine to $HOME so the platform opener cannot be
   // invoked on system locations or on a scheme-like string that would be
   // interpreted as a URL by xdg-open.
   let resolved = require_path_under_home(&path)?;
   let resolved_str = resolved.to_string_lossy().to_string();

   #[cfg(target_os = "macos")]
   {
      std::process::Command::new("open")
         .arg(&resolved_str)
         .spawn()
         .map_err(|e| e.to_string())?;
   }
   #[cfg(target_os = "windows")]
   {
      std::process::Command::new("cmd")
         .args(["/C", "start", "", &resolved_str])
         .spawn()
         .map_err(|e| e.to_string())?;
   }
   #[cfg(target_os = "linux")]
   {
      std::process::Command::new("xdg-open")
         .arg(&resolved_str)
         .spawn()
         .map_err(|e| e.to_string())?;
   }
   Ok(())
}

#[command]
#[specta::specta]
pub async fn toggle_quick_look(app: AppHandle, path: String) -> Result<(), String> {
   let resolved = require_path_under_home(&path)?;
   if !resolved.is_file() {
      return Err("Quick Look is only available for local files".to_string());
   }

   #[cfg(target_os = "macos")]
   {
      let (sender, receiver) = tokio::sync::oneshot::channel();
      app.run_on_main_thread(move || {
         let _ = sender.send(crate::bootstrap::macos::toggle_quick_look(&resolved));
      })
      .map_err(|error| error.to_string())?;
      receiver
         .await
         .map_err(|_| "Failed to open Quick Look on the main thread".to_string())??;
   }

   #[cfg(not(target_os = "macos"))]
   let _ = (app, resolved);

   Ok(())
}

#[command]
#[specta::specta]
pub async fn show_share_picker(window: tauri::WebviewWindow, path: String) -> Result<(), String> {
   let resolved = require_path_under_home(&path)?;
   if !resolved.is_file() {
      return Err("Share is only available for local files".to_string());
   }

   #[cfg(target_os = "macos")]
   {
      let app = window.app_handle().clone();
      let (sender, receiver) = tokio::sync::oneshot::channel();
      app.run_on_main_thread(move || {
         let result = window
            .ns_view()
            .map_err(|error| error.to_string())
            .and_then(|ns_view| crate::bootstrap::macos::show_share_picker(ns_view, &resolved));
         let _ = sender.send(result);
      })
      .map_err(|error| error.to_string())?;
      receiver
         .await
         .map_err(|_| "Failed to open Share Sheet on the main thread".to_string())??;
   }

   #[cfg(not(target_os = "macos"))]
   let _ = (window, resolved);

   Ok(())
}

#[derive(Serialize, specta::Type)]
pub struct SymlinkInfo {
   is_symlink: bool,
   target: Option<String>,
   is_dir: bool,
}

#[command]
#[specta::specta]
pub fn get_symlink_info(
   path: String,
   workspace_root: Option<String>,
) -> Result<SymlinkInfo, String> {
   // Require the symlink container itself to live under $HOME. We intentionally
   // inspect symlink_metadata of the raw path (not the canonical target) so the
   // caller can still discover symlinks that point outside the scope.
   let file_path_buf = require_symlink_container_under_home(&path)?;
   let file_path = file_path_buf.as_path();

   // Use symlink_metadata to get info without following the symlink
   let metadata =
      fs::symlink_metadata(file_path).map_err(|e| format!("Failed to get metadata: {}", e))?;

   let is_symlink = metadata.file_type().is_symlink();
   let is_dir = metadata.is_dir();

   let target = if is_symlink {
      // Read the symlink target
      match fs::read_link(file_path) {
         Ok(target_path) => {
            // Convert to workspace-relative path if possible
            let target_str = if let Some(root) = workspace_root {
               let root_path = Path::new(&root);
               let absolute_target = if target_path.is_absolute() {
                  target_path
               } else {
                  // Resolve relative symlink target
                  if let Some(parent) = file_path.parent() {
                     parent.join(&target_path)
                  } else {
                     target_path
                  }
               };

               // Try to make it relative to workspace root
               absolute_target
                  .strip_prefix(root_path)
                  .unwrap_or(&absolute_target)
                  .to_string_lossy()
                  .to_string()
            } else {
               target_path.to_string_lossy().to_string()
            };
            Some(target_str)
         }
         Err(_) => None, // Broken symlink
      }
   } else {
      None
   };

   Ok(SymlinkInfo {
      is_symlink,
      target,
      is_dir,
   })
}

#[command]
#[specta::specta]
pub fn rename_file(source_path: String, target_path: String) -> Result<(), String> {
   let source_buf = require_path_under_home(&source_path)?;
   let target_buf = require_path_under_home(&target_path)?;
   let source = source_buf.as_path();
   let target = target_buf.as_path();

   if !source.exists() {
      return Err("Source path does not exist".to_string());
   }

   if target.exists() {
      return Err("Target path already exists".to_string());
   }

   fs::rename(source, target).map_err(|e| format!("Failed to rename file: {}", e))?;

   Ok(())
}

#[command]
#[specta::specta]
pub fn move_file(source_path: String, target_path: String) -> Result<(), String> {
   let source_buf = require_path_under_home(&source_path)?;
   let target_buf = require_path_under_home(&target_path)?;
   let source = source_buf.as_path();
   let target = target_buf.as_path();

   // Validate source exists
   if !source.exists() {
      return Err("Source path does not exist".to_string());
   }

   // Validate target doesn't exist
   if target.exists() {
      return Err("Target path already exists".to_string());
   }

   // Ensure target directory exists
   if let Some(parent) = target.parent()
      && !parent.exists()
   {
      return Err("Target directory does not exist".to_string());
   }

   // Check if source is a directory
   if source.is_dir() {
      // Prevent moving a directory into itself
      if target.starts_with(source) {
         return Err("Cannot move a directory into itself".to_string());
      }
   }

   // Try to rename (fast for same filesystem)
   match fs::rename(source, target) {
      Ok(()) => Ok(()),
      Err(rename_err) => {
         // If rename fails, we need different strategies for files vs directories
         if source.is_file() {
            // For files, try copy + delete
            match fs::copy(source, target) {
               Ok(_) => match fs::remove_file(source) {
                  Ok(()) => Ok(()),
                  Err(del_err) => Err(format!(
                     "File copied but failed to delete source: {}",
                     del_err
                  )),
               },
               Err(copy_err) => Err(format!(
                  "Failed to move file: {} (rename: {}, copy: {})",
                  rename_err, rename_err, copy_err
               )),
            }
         } else if source.is_dir() {
            // For directories, we need to recursively copy and then remove
            copy_dir_all(source, target)?;
            remove_dir_all(source)?;
            Ok(())
         } else {
            Err("Source is neither a file nor a directory".to_string())
         }
      }
   }
}

// Helper function to recursively copy a directory
pub(super) fn copy_dir_all(src: &Path, dst: &Path) -> Result<(), String> {
   // Create the destination directory
   fs::create_dir_all(dst).map_err(|e| format!("Failed to create directory: {}", e))?;

   // Walk through all entries in the source directory
   for entry in WalkDir::new(src).min_depth(1) {
      let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
      let src_path = entry.path();

      // Calculate the relative path and create the destination path
      let relative_path = src_path
         .strip_prefix(src)
         .map_err(|e| format!("Failed to get relative path: {}", e))?;
      let dst_path = dst.join(relative_path);

      let file_type = entry.file_type();
      if file_type.is_dir() {
         // Create directory
         fs::create_dir_all(&dst_path).map_err(|e| format!("Failed to create directory: {}", e))?;
      } else if file_type.is_file() || src_path.is_file() {
         // Copy a file, or the file a symlink points to
         fs::copy(src_path, &dst_path).map_err(|e| format!("Failed to copy file: {}", e))?;
      } else if file_type.is_symlink() {
         // fs::copy cannot copy a link to a directory or a broken link, so recreate it
         copy_symlink(src_path, &dst_path)?;
      }
      // Sockets, FIFOs and device files have no content to copy and are skipped.
   }

   Ok(())
}

fn copy_symlink(src: &Path, dst: &Path) -> Result<(), String> {
   let target = fs::read_link(src).map_err(|e| format!("Failed to read symlink: {}", e))?;

   #[cfg(unix)]
   let result = std::os::unix::fs::symlink(&target, dst);
   #[cfg(windows)]
   let result = std::os::windows::fs::symlink_dir(&target, dst);

   result.map_err(|e| format!("Failed to copy symlink: {}", e))
}

// Helper function to recursively remove a directory
pub(super) fn remove_dir_all(path: &Path) -> Result<(), String> {
   fs::remove_dir_all(path).map_err(|e| format!("Failed to remove directory: {}", e))
}

#[cfg(all(test, unix))]
mod copy_dir_tests {
   use super::copy_dir_all;
   use std::{fs, os::unix::fs::symlink, path::PathBuf};

   fn temp_dir(name: &str) -> PathBuf {
      let dir =
         std::env::temp_dir().join(format!("athas-copy-dir-{}-{}", name, std::process::id()));
      let _ = fs::remove_dir_all(&dir);
      fs::create_dir_all(&dir).unwrap();
      dir
   }

   #[test]
   fn copies_links_to_directories_and_broken_links() {
      let root = temp_dir("links");
      let src = root.join("src");
      fs::create_dir_all(src.join("nested")).unwrap();
      fs::write(src.join("nested/file.txt"), "hello").unwrap();
      symlink("nested", src.join("dir-link")).unwrap();
      symlink("nested/file.txt", src.join("file-link")).unwrap();
      symlink("missing", src.join("broken-link")).unwrap();

      let dst = root.join("dst");
      copy_dir_all(&src, &dst).unwrap();

      assert_eq!(
         fs::read_to_string(dst.join("nested/file.txt")).unwrap(),
         "hello"
      );
      assert_eq!(fs::read_to_string(dst.join("file-link")).unwrap(), "hello");
      assert!(
         !fs::symlink_metadata(dst.join("file-link"))
            .unwrap()
            .file_type()
            .is_symlink()
      );
      assert_eq!(
         fs::read_link(dst.join("dir-link")).unwrap(),
         PathBuf::from("nested")
      );
      assert_eq!(
         fs::read_link(dst.join("broken-link")).unwrap(),
         PathBuf::from("missing")
      );

      fs::remove_dir_all(root).unwrap();
   }
}

#[cfg(test)]
mod directory_size_tests {
   use super::calculate_directory_size;
   use std::fs;
   use tempfile::tempdir;

   #[test]
   fn calculates_nested_file_sizes() {
      let directory = tempdir().expect("temp directory");
      let nested = directory.path().join("nested");
      fs::create_dir(&nested).expect("nested directory");
      fs::write(directory.path().join("first.txt"), b"athas").expect("first file");
      fs::write(nested.join("second.txt"), b"editor").expect("second file");

      assert_eq!(calculate_directory_size(directory.path()), Ok(11));
   }

   #[test]
   fn rejects_files() {
      let directory = tempdir().expect("temp directory");
      let file = directory.path().join("file.txt");
      fs::write(&file, b"athas").expect("file");

      assert_eq!(
         calculate_directory_size(&file),
         Err("Path is not a directory".to_string())
      );
   }
}

#[cfg(test)]
mod checked_write_tests {
   use super::*;

   fn digest(text: &str) -> ExpectedFileDigest {
      ExpectedFileDigest {
         byte_length: text.len() as u32,
         sha256: format!("{:x}", Sha256::digest(text.as_bytes())),
      }
   }

   #[test]
   fn digest_is_standard_sha256() {
      assert_eq!(
         digest("abc").sha256,
         "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
      );
      assert_eq!(
         digest(&"a".repeat(1_000_000)).sha256,
         "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"
      );
   }

   #[test]
   fn digest_matches_the_same_text_with_or_without_a_bom() {
      let expected = digest("before\r\n");
      assert!(matches_expected_digest(Some("before\r\n"), Some(&expected)));
      assert!(matches_expected_digest(
         Some("\u{feff}before\r\n"),
         Some(&expected)
      ));
      assert!(!matches_expected_digest(Some("before\n"), Some(&expected)));
      assert!(!matches_expected_digest(None, Some(&expected)));
      assert!(matches_expected_digest(None, None));
      assert!(!matches_expected_digest(Some(""), None));
   }
}
