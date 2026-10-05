use athas_project::{FileWatcher, Subscriber};
use std::{path::Path, sync::Arc, time::Instant};
use tauri::{AppHandle, Manager, WebviewWindow, command};

fn short_path(path: &str) -> String {
   Path::new(path)
      .file_name()
      .and_then(|name| name.to_str())
      .unwrap_or(path)
      .to_string()
}

fn window_subscriber(window: &WebviewWindow) -> Subscriber {
   Subscriber::Window(window.label().to_string())
}

/// Stops every watch a closed window held.
pub fn forget_window_watches(app: &AppHandle, label: &str) {
   if let Some(watcher) = app.try_state::<Arc<FileWatcher>>() {
      watcher.forget_subscriber(&Subscriber::Window(label.to_string()));
   }
}

/// Watches a workspace root for the calling window. Batches for it go to that window only.
#[command]
#[specta::specta]
pub async fn set_project_root(
   path: String,
   window: WebviewWindow,
   file_watcher: tauri::State<'_, Arc<FileWatcher>>,
) -> Result<(), String> {
   let started_at = Instant::now();
   let short = short_path(&path);
   log::info!("[watcher] set_project_root:start {}", short);
   let watcher = Arc::clone(&file_watcher);
   let subscriber = window_subscriber(&window);
   // Registering per-directory watches on Linux walks the tree.
   tauri::async_runtime::spawn_blocking(move || watcher.watch_root(&path, subscriber))
      .await
      .map_err(|error| error.to_string())?
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

/// Stops watching a workspace root for the calling window. The root stays watched while other
/// windows or the search index still use it.
#[command]
#[specta::specta]
pub async fn stop_watching(
   path: String,
   window: WebviewWindow,
   file_watcher: tauri::State<'_, Arc<FileWatcher>>,
) -> Result<(), String> {
   file_watcher.unwatch_root(&path, &window_subscriber(&window));
   Ok(())
}
