use crate::app_runtime::AppHandle;
use athas_fff_search::{FffIndexedFile, FffScanStatus, FffSearch, FffSearchHit};
use nucleo_matcher::{
   Config, Matcher, Utf32Str,
   pattern::{Atom, AtomKind, CaseMatching, Normalization},
};
use serde::{Deserialize, Serialize};
use std::{
   path::PathBuf,
   sync::{Mutex, OnceLock},
};
use tauri::{Manager, State};

#[derive(Debug, Serialize, Deserialize)]
pub struct FuzzyMatchItem {
   pub text: String,
   pub score: i64,
   pub indices: Vec<u32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FuzzyMatchRequest {
   pub pattern: String,
   pub items: Vec<String>,
   pub case_sensitive: Option<bool>,
   pub normalize: Option<bool>,
}

#[tauri::command]
pub fn fuzzy_match(request: FuzzyMatchRequest) -> Vec<FuzzyMatchItem> {
   if request.pattern.is_empty() || request.items.is_empty() {
      return request
         .items
         .into_iter()
         .map(|text| FuzzyMatchItem {
            text,
            score: 0,
            indices: vec![],
         })
         .collect();
   }

   let case_matching = if request.case_sensitive.unwrap_or(false) {
      CaseMatching::Respect
   } else {
      CaseMatching::Smart
   };

   let normalization = if request.normalize.unwrap_or(true) {
      Normalization::Smart
   } else {
      Normalization::Never
   };

   let atom = Atom::new(
      &request.pattern,
      case_matching,
      normalization,
      AtomKind::Fuzzy,
      false,
   );

   let mut matcher = Matcher::new(Config::DEFAULT);
   let mut matches: Vec<FuzzyMatchItem> = Vec::new();

   for item in request.items {
      let mut indices = Vec::new();
      let mut buf = Vec::new();
      let utf32_str = Utf32Str::new(&item, &mut buf);

      if let Some(score) = atom.indices(utf32_str, &mut matcher, &mut indices) {
         matches.push(FuzzyMatchItem {
            text: item,
            score: score as i64,
            indices,
         });
      }
   }

   // Sort by score in descending order
   matches.sort_by_key(|item| std::cmp::Reverse(item.score));

   matches
}

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
