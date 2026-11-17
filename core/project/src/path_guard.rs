//! Canonicalization checks for filesystem IPC commands.
//!
//! The app's custom fs commands use `std::fs` directly and therefore bypass Tauri's `fs:scope`
//! capability. These checks keep IPC inputs limited to concrete local filesystem paths: they
//! reject empty, NUL-containing, relative, and parentless paths and resolve `..` and symlinks
//! before any operation runs.
//!
//! Paths are not confined to the home directory. Workspaces can live anywhere, such as on another
//! drive on Windows or a mounted volume, so that restriction was dropped.

use std::path::{Path, PathBuf};

/// Resolves `path` to an absolute canonical form.
///
/// An existing path is canonicalized directly, following symlinks, without the `\\?\` verbatim
/// prefix Windows would otherwise add, since shell commands such as `cmd /C start` reject it. For a
/// not-yet-existing target (e.g. the destination of a rename) the parent directory is canonicalized
/// and the final file name is joined back on.
pub fn resolve_local_path(path: &str) -> Result<PathBuf, String> {
   let candidate = require_absolute(path)?;

   if candidate.exists() {
      return dunce::canonicalize(candidate).map_err(|e| format!("Failed to resolve path: {}", e));
   }

   resolve_parent(candidate)
}

/// Resolves the *parent directory* of `path` without resolving `path` itself, for operations
/// that inspect a symlink rather than what it points to.
pub fn resolve_symlink_path(path: &str) -> Result<PathBuf, String> {
   resolve_parent(require_absolute(path)?)
}

fn require_absolute(path: &str) -> Result<&Path, String> {
   if path.trim().is_empty() {
      return Err("path must not be empty".to_string());
   }
   if path.contains('\0') {
      return Err("path must not contain NUL bytes".to_string());
   }

   let candidate = Path::new(path);
   if !candidate.is_absolute() {
      return Err("Path must be absolute".to_string());
   }
   Ok(candidate)
}

fn resolve_parent(candidate: &Path) -> Result<PathBuf, String> {
   let parent = candidate
      .parent()
      .ok_or_else(|| "Path has no parent".to_string())?;
   if parent.as_os_str().is_empty() {
      return Err("Path must be absolute or contain a parent directory".to_string());
   }
   let parent_canonical =
      dunce::canonicalize(parent).map_err(|e| format!("Failed to resolve parent path: {}", e))?;
   let file_name = candidate
      .file_name()
      .ok_or_else(|| "Path has no file name".to_string())?;
   Ok(parent_canonical.join(file_name))
}

#[cfg(test)]
mod tests;
