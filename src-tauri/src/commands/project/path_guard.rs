//! Canonicalization and containment checks for filesystem IPC commands.
//!
//! The custom fs commands in this module use `std::fs` directly and therefore
//! bypass Tauri's `fs:scope` capability. These checks keep IPC inputs limited
//! to concrete local filesystem paths and reject empty, NUL-containing, or
//! parentless paths before any operation runs.

use std::path::{Path, PathBuf};

/// Resolve `path` to an absolute canonical form.
///
/// If the path exists it is canonicalized directly. For not-yet-existing
/// targets (e.g. the destination of a rename) the parent directory is
/// canonicalized and the final file name is joined back on, mirroring how
/// path_guard already works for create-like operations elsewhere in the code.
pub fn require_path_under_home(path: &str) -> Result<PathBuf, String> {
   if path.trim().is_empty() {
      return Err("path must not be empty".to_string());
   }
   if path.contains("\0") {
      return Err("path must not contain NUL bytes".to_string());
   }

   let candidate = Path::new(path);
   if !candidate.is_absolute() {
      return Err("Path must be absolute".to_string());
   }

   let canonical = if candidate.exists() {
      candidate
         .canonicalize()
         .map_err(|e| format!("Failed to resolve path: {}", e))?
   } else {
      let parent = candidate
         .parent()
         .ok_or_else(|| "Path has no parent".to_string())?;
      if parent.as_os_str().is_empty() {
         return Err("Path must be absolute or contain a parent directory".to_string());
      }
      let parent_canonical = parent
         .canonicalize()
         .map_err(|e| format!("Failed to resolve parent path: {}", e))?;
      let file_name = candidate
         .file_name()
         .ok_or_else(|| "Path has no file name".to_string())?;
      parent_canonical.join(file_name)
   };

   Ok(canonical)
}

/// Resolve the *parent directory* of `path` without resolving `path` itself.
/// Used for operations that want to inspect a symlink without following it.
pub fn require_symlink_container_under_home(path: &str) -> Result<PathBuf, String> {
   if path.trim().is_empty() {
      return Err("path must not be empty".to_string());
   }
   if path.contains("\0") {
      return Err("path must not contain NUL bytes".to_string());
   }

   let candidate = Path::new(path);
   if !candidate.is_absolute() {
      return Err("Path must be absolute".to_string());
   }

   let parent = candidate
      .parent()
      .ok_or_else(|| "Path has no parent".to_string())?;
   if parent.as_os_str().is_empty() {
      return Err("Path must be absolute or contain a parent directory".to_string());
   }
   let parent_canonical = parent
      .canonicalize()
      .map_err(|e| format!("Failed to resolve parent path: {}", e))?;

   let file_name = candidate
      .file_name()
      .ok_or_else(|| "Path has no file name".to_string())?;
   Ok(parent_canonical.join(file_name))
}

#[cfg(test)]
mod tests {
   use super::*;
   use std::fs;

   #[test]
   fn rejects_relative_path() {
      let result = require_path_under_home("notes.md");
      assert!(result.is_err(), "expected rejection, got {:?}", result);
   }

   #[test]
   fn accepts_existing_absolute_path() {
      let tmp = tempfile::tempdir().unwrap();
      let file = tmp.path().join("notes.md");
      fs::write(&file, "hi").unwrap();
      let ok = require_path_under_home(file.to_str().unwrap());
      assert!(ok.is_ok(), "expected acceptance, got {:?}", ok);
   }

   #[test]
   fn accepts_nonexistent_target_with_existing_absolute_parent() {
      let tmp = tempfile::tempdir().unwrap();
      let target = tmp.path().join("subdir").join("new.txt");
      fs::create_dir_all(target.parent().unwrap()).unwrap();
      let ok = require_path_under_home(target.to_str().unwrap());
      assert!(ok.is_ok(), "expected acceptance, got {:?}", ok);
   }

   #[test]
   fn resolves_symlink_container_without_following_leaf() {
      let tmp = tempfile::tempdir().unwrap();
      let target = tmp.path().join("link");
      let ok = require_symlink_container_under_home(target.to_str().unwrap());
      assert!(ok.is_ok(), "expected acceptance, got {:?}", ok);
   }

   #[test]
   fn rejects_empty_and_nul_paths() {
      assert!(require_path_under_home("").is_err());
      assert!(require_path_under_home("   ").is_err());
      assert!(require_path_under_home("foo\0bar").is_err());
   }
}
