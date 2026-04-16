//! Canonicalization and containment checks for filesystem IPC commands.
//!
//! The custom fs commands in this module use `std::fs` directly and therefore
//! bypass Tauri's `fs:scope` capability. To keep the two layers consistent,
//! this guard enforces that every path operated on by IPC must canonicalize
//! underneath the user's home directory, which is the same scope granted to
//! the fs plugin (`$HOME/**`). This also prevents accidental or hostile
//! symlink traversal out of the intended workspace.

use std::path::{Path, PathBuf};

/// Resolve `path` to an absolute canonical form and require it to live under
/// the current user's home directory.
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

   let home = home_dir().ok_or_else(|| "HOME is not set".to_string())?;
   let home_canonical = home
      .canonicalize()
      .map_err(|e| format!("Failed to resolve HOME: {}", e))?;

   let candidate = Path::new(path);
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

   if !canonical.starts_with(&home_canonical) {
      return Err(format!(
         "Path '{}' is outside of the user's home directory",
         canonical.display()
      ));
   }

   Ok(canonical)
}

/// Require the *parent directory* of `path` to live under `$HOME` without
/// resolving `path` itself. Used for operations that want to inspect a
/// symlink without following it (for example, reporting symlink targets).
pub fn require_symlink_container_under_home(path: &str) -> Result<PathBuf, String> {
   if path.trim().is_empty() {
      return Err("path must not be empty".to_string());
   }
   if path.contains("\0") {
      return Err("path must not contain NUL bytes".to_string());
   }

   let home = home_dir().ok_or_else(|| "HOME is not set".to_string())?;
   let home_canonical = home
      .canonicalize()
      .map_err(|e| format!("Failed to resolve HOME: {}", e))?;

   let candidate = Path::new(path);
   let parent = candidate
      .parent()
      .ok_or_else(|| "Path has no parent".to_string())?;
   if parent.as_os_str().is_empty() {
      return Err("Path must be absolute or contain a parent directory".to_string());
   }
   let parent_canonical = parent
      .canonicalize()
      .map_err(|e| format!("Failed to resolve parent path: {}", e))?;
   if !parent_canonical.starts_with(&home_canonical) {
      return Err(format!(
         "Path '{}' is outside of the user's home directory",
         parent_canonical.display()
      ));
   }

   let file_name = candidate
      .file_name()
      .ok_or_else(|| "Path has no file name".to_string())?;
   Ok(parent_canonical.join(file_name))
}

#[cfg(unix)]
fn home_dir() -> Option<PathBuf> {
   std::env::var_os("HOME").map(PathBuf::from)
}

#[cfg(windows)]
fn home_dir() -> Option<PathBuf> {
   std::env::var_os("USERPROFILE").map(PathBuf::from)
}

#[cfg(not(any(unix, windows)))]
fn home_dir() -> Option<PathBuf> {
   None
}

#[cfg(test)]
mod tests {
   use super::*;
   use std::fs;

   /// Set HOME to the provided dir for the duration of `f`. Serialized via
   /// a mutex because tests mutate process-global env.
   fn with_home<F: FnOnce(&Path)>(tmp_home: &Path, f: F) {
      use std::sync::Mutex;
      static LOCK: Mutex<()> = Mutex::new(());
      let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());

      let original = std::env::var_os("HOME");
      #[cfg(windows)]
      let original_userprofile = std::env::var_os("USERPROFILE");

      // SAFETY: tests are single-threaded via LOCK above.
      unsafe {
         std::env::set_var("HOME", tmp_home);
         #[cfg(windows)]
         std::env::set_var("USERPROFILE", tmp_home);
      }

      f(tmp_home);

      unsafe {
         match original {
            Some(val) => std::env::set_var("HOME", val),
            None => std::env::remove_var("HOME"),
         }
         #[cfg(windows)]
         match original_userprofile {
            Some(val) => std::env::set_var("USERPROFILE", val),
            None => std::env::remove_var("USERPROFILE"),
         }
      }
   }

   #[test]
   fn rejects_path_outside_home() {
      let tmp = tempfile::tempdir().unwrap();
      with_home(tmp.path(), |_home| {
         let result = require_path_under_home("/etc/passwd");
         assert!(result.is_err(), "expected rejection, got {:?}", result);
      });
   }

   #[test]
   fn accepts_existing_path_under_home() {
      let tmp = tempfile::tempdir().unwrap();
      with_home(tmp.path(), |home| {
         let file = home.join("notes.md");
         fs::write(&file, "hi").unwrap();
         let ok = require_path_under_home(file.to_str().unwrap());
         assert!(ok.is_ok(), "expected acceptance, got {:?}", ok);
      });
   }

   #[test]
   fn accepts_nonexistent_target_with_parent_under_home() {
      let tmp = tempfile::tempdir().unwrap();
      with_home(tmp.path(), |home| {
         let target = home.join("subdir").join("new.txt");
         fs::create_dir_all(target.parent().unwrap()).unwrap();
         let ok = require_path_under_home(target.to_str().unwrap());
         assert!(ok.is_ok(), "expected acceptance, got {:?}", ok);
      });
   }

   #[test]
   fn rejects_symlink_escaping_home() {
      let tmp_home = tempfile::tempdir().unwrap();
      let outside = tempfile::tempdir().unwrap();
      with_home(tmp_home.path(), |home| {
         let link = home.join("escape");
         #[cfg(unix)]
         std::os::unix::fs::symlink(outside.path(), &link).unwrap();
         #[cfg(windows)]
         std::os::windows::fs::symlink_dir(outside.path(), &link).unwrap();

         let result = require_path_under_home(link.to_str().unwrap());
         assert!(
            result.is_err(),
            "symlink escape must be rejected, got {:?}",
            result
         );
      });
   }

   #[test]
   fn rejects_empty_and_nul_paths() {
      let tmp = tempfile::tempdir().unwrap();
      with_home(tmp.path(), |_home| {
         assert!(require_path_under_home("").is_err());
         assert!(require_path_under_home("   ").is_err());
         assert!(require_path_under_home("foo\0bar").is_err());
      });
   }
}
