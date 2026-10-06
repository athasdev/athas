//! Runtime grants for the `asset:` protocol.
//!
//! `tauri.conf.json` only allows the app's own data, cache and resource
//! directories. Workspace folders and user-chosen files are added here on
//! demand, right before the frontend turns them into asset URLs. Only the
//! app's own origin can reach this command, so untrusted documents rendered in
//! sandboxed frames (for example the HTML preview) cannot widen the scope.
//!
//! Paths are not confined to the home directory: workspaces on other volumes
//! need their images served too, and the app origin can already read them
//! through the fs plugin. What this prevents is anything else loading files the
//! user never opened.

use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime, command};

/// Allow `path` to be served through the asset protocol. Directories are
/// allowed recursively; files are allowed individually.
#[command]
#[specta::specta]
pub fn allow_asset_path<R: Runtime>(app: AppHandle<R>, path: String) -> Result<(), String> {
   let resolved = resolve_existing_absolute_path(&path)?;
   let metadata =
      std::fs::metadata(&resolved).map_err(|error| format!("Failed to read path: {error}"))?;
   let scope = app.asset_protocol_scope();

   if metadata.is_dir() {
      ensure_not_filesystem_root(&resolved)?;
      scope
         .allow_directory(&resolved, true)
         .map_err(|error| format!("Failed to allow asset directory: {error}"))
   } else {
      scope
         .allow_file(&resolved)
         .map_err(|error| format!("Failed to allow asset file: {error}"))
   }
}

/// Allow a directory the app itself owns (for example the bundled extensions
/// directory in development builds, which lives in the source tree).
pub fn allow_internal_asset_directory<R: Runtime>(app: &AppHandle<R>, path: &Path) {
   if !path.is_dir() {
      return;
   }
   if let Err(error) = app.asset_protocol_scope().allow_directory(path, true) {
      log::warn!(
         "Failed to allow asset directory {}: {error}",
         path.display()
      );
   }
}

fn resolve_existing_absolute_path(path: &str) -> Result<PathBuf, String> {
   if path.trim().is_empty() || path.contains('\0') {
      return Err("Invalid path".to_string());
   }
   let candidate = Path::new(path);
   if !candidate.is_absolute() {
      return Err("Path must be absolute".to_string());
   }
   candidate
      .canonicalize()
      .map_err(|error| format!("Failed to resolve path: {error}"))
}

fn ensure_not_filesystem_root(path: &Path) -> Result<(), String> {
   if path.parent().is_none() {
      return Err("Refusing to expose a filesystem root to the asset protocol".to_string());
   }
   Ok(())
}

#[cfg(test)]
mod tests {
   use super::*;

   #[test]
   fn rejects_filesystem_root() {
      let root = std::env::temp_dir()
         .ancestors()
         .last()
         .expect("temp dir has a root")
         .to_path_buf();
      assert!(ensure_not_filesystem_root(&root).is_err());
   }

   #[test]
   fn accepts_nested_directory() {
      assert!(ensure_not_filesystem_root(&std::env::temp_dir()).is_ok());
   }

   #[test]
   fn allows_directories_recursively_and_files_individually() {
      let app = tauri::test::mock_app();
      let handle = app.handle().clone();
      let workspace =
         std::env::temp_dir().join(format!("athas-asset-scope-{}", std::process::id()));
      let nested = workspace.join("assets");
      std::fs::create_dir_all(&nested).unwrap();
      let image = nested.join("logo.png");
      std::fs::write(&image, b"png").unwrap();
      let outside =
         std::env::temp_dir().join(format!("athas-asset-outside-{}.png", std::process::id()));
      std::fs::write(&outside, b"png").unwrap();

      let scope = handle.asset_protocol_scope();
      assert!(!scope.is_allowed(&image));

      allow_asset_path(handle.clone(), workspace.to_string_lossy().into_owned()).unwrap();
      assert!(scope.is_allowed(&image));
      assert!(!scope.is_allowed(&outside));

      allow_asset_path(handle.clone(), outside.to_string_lossy().into_owned()).unwrap();
      assert!(scope.is_allowed(&outside));

      assert!(allow_asset_path(handle.clone(), "relative/path".to_string()).is_err());
      assert!(allow_asset_path(handle, "/definitely/missing/athas".to_string()).is_err());

      let _ = std::fs::remove_dir_all(&workspace);
      let _ = std::fs::remove_file(&outside);
   }
}
