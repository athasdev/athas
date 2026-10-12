pub(super) use athas_project::local_fs::{copy_dir_all, remove_dir_all};
use athas_project::{
   local_fs::{self, ExpectedFileDigest, SymlinkInfo},
   path_guard::{resolve_local_path, resolve_symlink_path},
};
use std::{fs, path::Path, time::Instant};
#[cfg(target_os = "macos")]
use tauri::Manager;
use tauri::{AppHandle, command};

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

#[command]
#[specta::specta]
pub async fn get_local_directory_size(path: String) -> Result<u64, String> {
   tauri::async_runtime::spawn_blocking(move || {
      let resolved = resolve_local_path(&path)?;
      local_fs::directory_size(&resolved)
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
         let resolved = resolve_local_path(&path)?;
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
      let resolved = resolve_local_path(&path)?;
      local_fs::write_text(&resolved, content)
   })
   .await
   .map_err(|error| format!("File write failed: {error}"))?
}

#[command]
#[specta::specta]
pub async fn write_local_file_checked(
   path: String,
   expected: Option<ExpectedFileDigest>,
   content: String,
) -> Result<(), String> {
   tauri::async_runtime::spawn_blocking(move || {
      let resolved = resolve_local_path(&path)?;
      local_fs::write_text_checked(&resolved, expected, content)
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
      let resolved = resolve_local_path(&path)?;
      athas_project::file_mutations::delete_text_if_unchanged(&resolved, &expected_content)
   })
   .await
   .map_err(|error| format!("Checked file deletion failed: {error}"))?
}

#[command]
#[specta::specta]
pub fn open_file_external(path: String) -> Result<(), String> {
   // Canonicalize to a concrete absolute path so the platform opener is never
   // handed a scheme-like string that xdg-open would interpret as a URL.
   let resolved = resolve_local_path(&path)?;
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
   let resolved = resolve_local_path(&path)?;
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
   let resolved = resolve_local_path(&path)?;
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

#[command]
#[specta::specta]
pub async fn get_symlink_info(
   path: String,
   workspace_root: Option<String>,
) -> Result<SymlinkInfo, String> {
   tauri::async_runtime::spawn_blocking(move || {
      // Only the link's container is resolved, so links pointing outside the scope are still
      // reported.
      let path = resolve_symlink_path(&path)?;
      local_fs::symlink_info(&path, workspace_root)
   })
   .await
   .map_err(|error| format!("Symlink info task failed: {error}"))?
}

#[command]
#[specta::specta]
pub fn rename_file(source_path: String, target_path: String) -> Result<(), String> {
   local_fs::rename_path(
      &resolve_local_path(&source_path)?,
      &resolve_local_path(&target_path)?,
   )
}

#[command]
#[specta::specta]
pub fn move_file(source_path: String, target_path: String) -> Result<(), String> {
   local_fs::move_path(
      &resolve_local_path(&source_path)?,
      &resolve_local_path(&target_path)?,
   )
}
