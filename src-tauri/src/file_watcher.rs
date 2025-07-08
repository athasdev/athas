use anyhow::{Result, bail};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer, DebouncedEvent};
use notify::RecursiveMode;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, serde::Serialize)]
pub struct FileChangeEvent {
    pub path: String,
    pub event_type: FileChangeType,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FileChangeType {
    Modified,
    Deleted,
}

pub struct FileWatcher {
    app_handle: AppHandle,
    debouncer: Arc<Mutex<Option<Debouncer<notify::RecommendedWatcher>>>>,
    watched_paths: Arc<Mutex<HashSet<PathBuf>>>,
}

impl FileWatcher {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            app_handle,
            debouncer: Arc::new(Mutex::new(None)),
            watched_paths: Arc::new(Mutex::new(HashSet::new())),
        }
    }

    pub async fn watch_path(&self, path: String) -> Result<()> {
        let path_buf = PathBuf::from(&path);

        if !path_buf.exists() {
            bail!("Path does not exist: {}", path);
        }

        let mut watched_paths = self.watched_paths.lock().unwrap();

        // Already watching this path
        if watched_paths.contains(&path_buf) {
            return Ok(());
        }

        // Initialize debouncer if not already done
        let mut debouncer_guard = self.debouncer.lock().unwrap();
        if debouncer_guard.is_none() {
            let app_handle = self.app_handle.clone();
            let watched_paths_clone = self.watched_paths.clone();

            let debouncer = new_debouncer(
                Duration::from_millis(300),
                move |result: DebounceEventResult| {
                    if let Ok(events) = result {
                        let watched = watched_paths_clone.lock().unwrap();

                        for DebouncedEvent { path, kind: _ } in events {
                            // Check if file was deleted
                            let exists = path.exists();
                            let is_watched = watched.contains(&path);

                            if is_watched {
                                let event_type = if exists {
                                    FileChangeType::Modified
                                } else {
                                    FileChangeType::Deleted
                                };

                                let change_event = FileChangeEvent {
                                    path: path.to_string_lossy().to_string(),
                                    event_type,
                                };
                                log::debug!("[FileWatcher] Emitting file-changed event for: {}", change_event.path);
                                let _ = app_handle.emit("file-changed", &change_event);
                            }
                        }
                    }
                }
            )?;

            *debouncer_guard = Some(debouncer);
        }

        // Watch the path
        if let Some(ref mut debouncer) = *debouncer_guard {
            let recursive_mode = if path_buf.is_dir() {
                RecursiveMode::Recursive
            } else {
                RecursiveMode::NonRecursive
            };

            debouncer.watcher().watch(&path_buf, recursive_mode)?;
            watched_paths.insert(path_buf);
        }

        Ok(())
    }

    pub fn stop_watching(&self, path: String) -> Result<()> {
        let path_buf = PathBuf::from(path);
        let mut watched_paths = self.watched_paths.lock().unwrap();

        if !watched_paths.remove(&path_buf) {
            bail!("Path was not being watched");
        }

        // Unwatch the path
        let mut debouncer_guard = self.debouncer.lock().unwrap();
        if let Some(ref mut debouncer) = *debouncer_guard {
            debouncer.watcher().unwatch(&path_buf)?;
        }

        Ok(())
    }

    // unused but this is useful for when we want to stop all watchers
    #[allow(dead_code)]
    pub fn stop_all_watchers(&self) {
        let mut watched_paths = self.watched_paths.lock().unwrap();
        let mut debouncer_guard = self.debouncer.lock().unwrap();

        // Unwatch all paths
        if let Some(ref mut debouncer) = *debouncer_guard {
            for path in watched_paths.iter() {
                let _ = debouncer.watcher().unwatch(path);
            }
        }

        watched_paths.clear();
        *debouncer_guard = None;
    }
}
