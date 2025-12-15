use crate::features::file_watcher::FileWatcher;
use std::sync::Arc;
use tauri::command;

#[command]
pub async fn start_watching(
   path: String,
   file_watcher: tauri::State<'_, Arc<FileWatcher>>,
) -> Result<(), String> {
   file_watcher
      .watch_path(path)
      .await
      .map_err(|e| e.to_string())
}

#[command]
pub async fn stop_watching(
   path: String,
   file_watcher: tauri::State<'_, Arc<FileWatcher>>,
) -> Result<(), String> {
   file_watcher.stop_watching(path).map_err(|e| e.to_string())
}

#[command]
pub async fn set_project_root(
   path: String,
   file_watcher: tauri::State<'_, Arc<FileWatcher>>,
) -> Result<(), String> {
   // Start watching the project root recursively
   file_watcher
      .watch_path(path)
      .await
      .map_err(|e| e.to_string())
}
