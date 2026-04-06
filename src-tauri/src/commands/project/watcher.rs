use athas_project::FileWatcher;
use std::{path::Path, sync::Arc, time::Instant};
use tauri::command;

fn short_path(path: &str) -> String {
   Path::new(path)
      .file_name()
      .and_then(|name| name.to_str())
      .unwrap_or(path)
      .to_string()
}

#[command]
pub async fn start_watching(
   path: String,
   file_watcher: tauri::State<'_, Arc<FileWatcher>>,
) -> Result<(), String> {
   let started_at = Instant::now();
   let short = short_path(&path);
   log::info!("[watcher] start_watching:start {}", short);
   let path_for_call = path.clone();
   file_watcher
      .watch_path(path_for_call)
      .await
      .inspect(|_| {
         log::info!(
            "[watcher] start_watching:end {} {}ms",
            short,
            started_at.elapsed().as_millis(),
         );
      })
      .map_err(|e| {
         log::error!(
            "[watcher] start_watching:error {} {}ms {}",
            short,
            started_at.elapsed().as_millis(),
            e
         );
         e.to_string()
      })
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
   let started_at = Instant::now();
   let short = short_path(&path);
   log::info!("[watcher] set_project_root:start {}", short);
   let path_for_call = path.clone();
   // Watching the project root recursively can overwhelm large repositories.
   // Keep root watching shallow; explicit file watches can stay recursive when needed.
   file_watcher
      .watch_project_root(path_for_call)
      .await
      .inspect(|_| {
         log::info!(
            "[watcher] set_project_root:end {} {}ms",
            short,
            started_at.elapsed().as_millis(),
         );
      })
      .map_err(|e| {
         log::error!(
            "[watcher] set_project_root:error {} {}ms {}",
            short,
            started_at.elapsed().as_millis(),
            e
         );
         e.to_string()
      })
}
