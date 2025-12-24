use anyhow::{Context, Result, bail};
use notify::RecursiveMode;
use notify_debouncer_mini::{DebounceEventResult, Debouncer, new_debouncer};
use std::{
   collections::{HashMap, HashSet},
   path::PathBuf,
   sync::{Arc, Mutex},
   time::{Duration, SystemTime},
};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, serde::Serialize)]
pub struct FileChangeEvent {
   pub path: String,
   pub event_type: FileChangeType,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FileChangeType {
   Opened,
   Reloaded,
   Deleted,
}

pub struct FileWatcher {
   app_handle: AppHandle,
   debouncer: Arc<Mutex<Option<Debouncer<notify::RecommendedWatcher>>>>,
   watched_paths: Arc<Mutex<HashSet<PathBuf>>>,
   watched_directories: Arc<Mutex<HashSet<PathBuf>>>,
   known_files: Arc<Mutex<HashMap<PathBuf, SystemTime>>>,
}

impl FileWatcher {
   pub fn new(app_handle: AppHandle) -> Self {
      Self {
         app_handle,
         debouncer: Arc::new(Mutex::new(None)),
         watched_paths: Arc::new(Mutex::new(HashSet::new())),
         watched_directories: Arc::new(Mutex::new(HashSet::new())),
         known_files: Arc::new(Mutex::new(HashMap::new())),
      }
   }

   pub async fn watch_path(&self, path: String) -> Result<()> {
      let path_buf = PathBuf::from(&path);

      if !path_buf.exists() {
         bail!("Path does not exist: {}", path);
      }

      let mut watched_paths = self.watched_paths.lock().unwrap();
      if watched_paths.contains(&path_buf) {
         return Ok(());
      }

      self.ensure_debouncer_initialized()?;
      self.setup_path_watching(&path_buf, &mut watched_paths)?;

      // Emit an "Opened" event for clarity in the app UI
      let change_event = FileChangeEvent {
         path: path_buf.to_string_lossy().to_string(),
         event_type: FileChangeType::Opened,
      };
      log::debug!(
         "[FileWatcher] Emitting opened event for: {}",
         change_event.path
      );
      let _ = self.app_handle.emit("file-changed", &change_event);

      Ok(())
   }

   fn ensure_debouncer_initialized(&self) -> Result<()> {
      let mut debouncer_guard = self.debouncer.lock().unwrap();
      if debouncer_guard.is_some() {
         return Ok(());
      }

      let debouncer = self.create_debouncer()?;
      *debouncer_guard = Some(debouncer);
      Ok(())
   }

   fn create_debouncer(&self) -> Result<Debouncer<notify::RecommendedWatcher>> {
      let app_handle = self.app_handle.clone();
      let watched_paths = self.watched_paths.clone();
      let watched_directories = self.watched_directories.clone();
      let known_files = self.known_files.clone();

      Ok(new_debouncer(
         Duration::from_millis(300),
         move |result: DebounceEventResult| {
            if let Ok(events) = result {
               Self::handle_events(
                  events,
                  &app_handle,
                  &watched_paths,
                  &watched_directories,
                  &known_files,
               );
            }
         },
      )?)
   }

   fn handle_events(
      events: Vec<notify_debouncer_mini::DebouncedEvent>,
      app_handle: &AppHandle,
      watched_paths: &Arc<Mutex<HashSet<PathBuf>>>,
      watched_directories: &Arc<Mutex<HashSet<PathBuf>>>,
      known_files: &Arc<Mutex<HashMap<PathBuf, SystemTime>>>,
   ) {
      let watched_paths = watched_paths.lock().unwrap();
      let watched_dirs = watched_directories.lock().unwrap();

      for event in events {
         if !Self::is_path_watched(&event.path, &watched_paths, &watched_dirs) {
            continue;
         }

         let event_type = Self::determine_event_type(&event.path, known_files);

         // Only emit event if it's not a metadata-only change
         if let Some(event_type) = event_type {
            let change_event = FileChangeEvent {
               path: event.path.to_string_lossy().to_string(),
               event_type,
            };

            log::debug!(
               "[FileWatcher] Emitting file-changed event for: {} ({:?})",
               change_event.path,
               change_event.event_type
            );
            let _ = app_handle.emit("file-changed", &change_event);
         }
      }
   }

   fn is_path_watched(
      path: &PathBuf,
      watched_paths: &HashSet<PathBuf>,
      watched_dirs: &HashSet<PathBuf>,
   ) -> bool {
      watched_paths.contains(path) || watched_dirs.iter().any(|dir| path.starts_with(dir))
   }

   fn determine_event_type(
      path: &PathBuf,
      known_files: &Arc<Mutex<HashMap<PathBuf, SystemTime>>>,
   ) -> Option<FileChangeType> {
      let mut files = known_files.lock().unwrap();

      if !path.exists() {
         files.remove(path);
         Some(FileChangeType::Deleted)
      } else if let Ok(metadata) = std::fs::metadata(path) {
         // Handle modification time explicitly to avoid misleading UNIX_EPOCH fallback
         let current_mtime = match metadata.modified() {
            Ok(mtime) => mtime,
            Err(err) => {
               log::warn!(
                  "[FileWatcher] Could not get modification time for {:?}: {}",
                  path,
                  err
               );
               SystemTime::now()
            }
         };

         if let Some(&stored_mtime) = files.get(path) {
            if stored_mtime == current_mtime {
               None
            } else {
               files.insert(path.clone(), current_mtime);
               Some(FileChangeType::Reloaded)
            }
         } else {
            files.insert(path.clone(), current_mtime);
            Some(FileChangeType::Opened)
         }
      } else {
         log::warn!(
            "[FileWatcher] Could not read metadata for {:?}, treating as reload",
            path
         );
         Some(FileChangeType::Reloaded)
      }
   }

   fn setup_path_watching(
      &self,
      path_buf: &PathBuf,
      watched_paths: &mut HashSet<PathBuf>,
   ) -> Result<()> {
      let mut debouncer_guard = self.debouncer.lock().unwrap();
      let debouncer = debouncer_guard
         .as_mut()
         .context("Debouncer should be initialized")?;

      let recursive_mode = if path_buf.is_dir() {
         RecursiveMode::Recursive
      } else {
         RecursiveMode::NonRecursive
      };

      debouncer.watcher().watch(path_buf, recursive_mode)?;

      if path_buf.is_dir() {
         self.setup_directory_watching(path_buf)?;
      } else {
         // Track initial modification time for files, handle errors explicitly
         if let Ok(metadata) = std::fs::metadata(path_buf) {
            let mtime = match metadata.modified() {
               Ok(t) => t,
               Err(err) => {
                  log::warn!(
                     "[FileWatcher] Could not get initial modification time for {:?}: {}",
                     path_buf,
                     err
                  );
                  SystemTime::now()
               }
            };
            self
               .known_files
               .lock()
               .unwrap()
               .insert(path_buf.clone(), mtime);
         }
      }

      watched_paths.insert(path_buf.clone());
      Ok(())
   }

   fn setup_directory_watching(&self, path_buf: &PathBuf) -> Result<()> {
      self
         .watched_directories
         .lock()
         .unwrap()
         .insert(path_buf.clone());

      let entries = std::fs::read_dir(path_buf)?;
      let mut known_files = self.known_files.lock().unwrap();

      entries
         .flatten()
         .map(|entry| entry.path())
         .filter(|path| path.is_file())
         .for_each(|path| {
            if let Ok(metadata) = std::fs::metadata(&path) {
               let mtime = match metadata.modified() {
                  Ok(t) => t,
                  Err(err) => {
                     log::warn!(
                        "[FileWatcher] Could not get initial modification time for {:?}: {}",
                        path,
                        err
                     );
                     SystemTime::now()
                  }
               };
               known_files.insert(path, mtime);
            }
         });

      Ok(())
   }

   pub fn stop_watching(&self, path: String) -> Result<()> {
      let path_buf = PathBuf::from(path);
      let mut watched_paths = self.watched_paths.lock().unwrap();

      if !watched_paths.remove(&path_buf) {
         bail!("Path was not being watched");
      }

      // Remove from watched directories if it's a directory
      if path_buf.is_dir() {
         let mut watched_dirs = self.watched_directories.lock().unwrap();
         watched_dirs.remove(&path_buf);
      }

      // Remove from known files tracking
      self.known_files.lock().unwrap().remove(&path_buf);

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
      self.known_files.lock().unwrap().clear();
      *debouncer_guard = None;
   }
}
