use athas_fff_search::{FffIndexedFile, FffScanStatus, FffSearch, FffSearchHit};
use std::{
   path::PathBuf,
   sync::{Mutex, OnceLock},
};
use tauri::{AppHandle, Manager, State};

pub struct FffSearchState {
   fff: OnceLock<FffSearch>,
   init_lock: Mutex<()>,
}

impl FffSearchState {
   pub fn new() -> Self {
      Self {
         fff: OnceLock::new(),
         init_lock: Mutex::new(()),
      }
   }

   pub(crate) fn get_or_init(&self, app: &AppHandle) -> Result<&FffSearch, String> {
      if let Some(fff) = self.fff.get() {
         return Ok(fff);
      }

      let _init_guard = self
         .init_lock
         .lock()
         .map_err(|error| format!("fff init lock: {error}"))?;
      if let Some(fff) = self.fff.get() {
         return Ok(fff);
      }

      let data_dir = app
         .path()
         .app_data_dir()
         .map_err(|e| format!("app_data_dir: {e}"))?;
      let db_path: PathBuf = data_dir.join("fff-frecency.lmdb");
      let fff = FffSearch::new(db_path).map_err(|e| format!("fff init: {e}"))?;
      self
         .fff
         .set(fff)
         .map_err(|_| "fff initialization raced unexpectedly".to_string())?;
      self
         .fff
         .get()
         .ok_or_else(|| "fff initialization failed".to_string())
   }

   pub(crate) fn ensure_workspaces(
      &self,
      app: &AppHandle,
      base_paths: &[PathBuf],
   ) -> Result<(), String> {
      let fff = self.get_or_init(app)?;
      fff.ensure_workspaces(base_paths.iter().map(PathBuf::as_path))
         .map_err(|e| format!("fff ensure_workspaces: {e}"))
   }

   pub(crate) fn scan_status(
      &self,
      app: &AppHandle,
      base_paths: &[PathBuf],
   ) -> Result<FffScanStatus, String> {
      self.ensure_workspaces(app, base_paths)?;
      let fff = self.get_or_init(app)?;
      fff.scan_status(base_paths.iter().map(PathBuf::as_path))
         .map_err(|e| format!("fff scan_status: {e}"))
   }
}

fn should_skip_fff_path(path: &str) -> bool {
   path.starts_with("remote://")
      || path.starts_with("wsl://")
      || path.starts_with("diff://")
      || path.trim().is_empty()
}

pub(crate) fn local_workspace_paths(paths: Vec<String>) -> Vec<PathBuf> {
   paths
      .into_iter()
      .filter(|path| !should_skip_fff_path(path))
      .map(PathBuf::from)
      .collect()
}

#[tauri::command]
#[specta::specta]
pub fn fff_ensure_workspaces(
   app: AppHandle,
   state: State<'_, FffSearchState>,
   root_paths: Vec<String>,
) -> Result<(), String> {
   let root_paths = local_workspace_paths(root_paths);
   if root_paths.is_empty() {
      return Ok(());
   }
   state.ensure_workspaces(&app, &root_paths)
}

#[tauri::command]
#[specta::specta]
pub fn fff_search_files(
   app: AppHandle,
   state: State<'_, FffSearchState>,
   query: String,
   limit: Option<usize>,
   root_paths: Vec<String>,
) -> Result<Vec<FffSearchHit>, String> {
   if query.trim().is_empty() {
      return Ok(Vec::new());
   }

   let root_paths = local_workspace_paths(root_paths);
   if root_paths.is_empty() {
      return Ok(Vec::new());
   }
   state.ensure_workspaces(&app, &root_paths)?;
   let fff = state.get_or_init(&app)?;
   fff.search(
      root_paths.iter().map(PathBuf::as_path),
      &query,
      limit.unwrap_or(100),
   )
   .map_err(|e| format!("fff search: {e}"))
}

#[tauri::command]
#[specta::specta]
pub fn fff_scan_status(
   app: AppHandle,
   state: State<'_, FffSearchState>,
   root_paths: Vec<String>,
) -> Result<FffScanStatus, String> {
   let root_paths = local_workspace_paths(root_paths);
   if root_paths.is_empty() {
      return Ok(FffScanStatus::default());
   }
   state.scan_status(&app, &root_paths)
}

#[tauri::command]
#[specta::specta]
pub fn fff_list_files(
   app: AppHandle,
   state: State<'_, FffSearchState>,
   root_paths: Vec<String>,
) -> Result<Vec<FffIndexedFile>, String> {
   let root_paths = local_workspace_paths(root_paths);
   if root_paths.is_empty() {
      return Ok(Vec::new());
   }
   state.ensure_workspaces(&app, &root_paths)?;
   state
      .get_or_init(&app)?
      .list_files(root_paths.iter().map(PathBuf::as_path))
      .map_err(|e| format!("fff list_files: {e}"))
}

#[tauri::command]
#[specta::specta]
pub fn fff_track_access(
   app: AppHandle,
   state: State<'_, FffSearchState>,
   path: String,
) -> Result<(), String> {
   if should_skip_fff_path(&path) {
      return Ok(());
   }

   let fff = state.get_or_init(&app)?;
   fff.track_access(std::path::Path::new(&path))
      .map_err(|e| format!("fff track_access: {e}"))
}
