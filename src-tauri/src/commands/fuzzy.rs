use crate::app_runtime::AppHandle;
use athas_fff_search::{FffSearch, FffSearchHit};
use nucleo_matcher::{
   Config, Matcher, Utf32Str,
   pattern::{Atom, AtomKind, CaseMatching, Normalization},
};
use serde::{Deserialize, Serialize};
use std::{
   path::{Path, PathBuf},
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

#[derive(Debug, Serialize, Deserialize)]
pub struct CompletionFilterRequest {
   pub pattern: String,
   pub completions: Vec<CompletionItem>,
   pub context_word: String,
   pub context_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionItem {
   pub label: String,
   pub kind: Option<i32>,
   pub detail: Option<String>,
   pub documentation: Option<String>,
   pub sort_text: Option<String>,
   pub filter_text: Option<String>,
   pub insert_text: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FilteredCompletion {
   pub item: CompletionItem,
   pub score: i64,
   pub indices: Vec<u32>,
}

#[tauri::command]
pub fn filter_completions(request: CompletionFilterRequest) -> Vec<FilteredCompletion> {
   if request.context_word.is_empty() {
      // Return all completions if no context word
      return request
         .completions
         .into_iter()
         .map(|item| FilteredCompletion {
            item,
            score: 0,
            indices: vec![],
         })
         .collect();
   }

   let atom = Atom::new(
      &request.context_word,
      CaseMatching::Smart,
      Normalization::Smart,
      AtomKind::Substring,
      false,
   );

   let mut matcher = Matcher::new(Config::DEFAULT);
   let mut filtered: Vec<FilteredCompletion> = Vec::new();

   for completion in request.completions {
      let mut indices = Vec::new();
      let mut buf = Vec::new();

      // Use filter_text if available, otherwise use label
      let text_to_match = completion.filter_text.as_ref().unwrap_or(&completion.label);

      let utf32_str = Utf32Str::new(text_to_match, &mut buf);

      if let Some(score) = atom.indices(utf32_str, &mut matcher, &mut indices) {
         let mut final_score = score as i64;

         // Boost score based on completion kind and context
         if let Some(kind) = completion.kind {
            // Base score based on kind
            let base_boost = match kind {
               5 => 100, // Field
               6 => 150, // Variable
               3 => 200, // Function
               4 => 250, // Constructor
               8 => 300, // Interface
               7 => 300, // Class
               _ => 0,
            };

            // Apply context-specific boosts
            let context_multiplier = match request.context_type.as_deref() {
               Some("member") => match kind {
                  3 | 5 => 2.0, // Boost methods and fields for member access
                  _ => 1.0,
               },
               Some("type") => match kind {
                  7..=9 => 2.0, // Boost classes, interfaces, enums for type context
                  _ => 0.5,
               },
               Some("import") => match kind {
                  9 => 2.0, // Boost modules for import context
                  _ => 1.0,
               },
               _ => 1.0,
            };

            final_score += (base_boost as f64 * context_multiplier) as i64;
         }

         // Consider sort_text if available
         if let Some(sort_text) = &completion.sort_text {
            // Lower sort_text should get higher score
            if sort_text.len() <= 3 {
               final_score += 50;
            }
         }

         filtered.push(FilteredCompletion {
            item: completion,
            score: final_score,
            indices,
         });
      }
   }

   // Sort by score in descending order
   filtered.sort_by_key(|item| std::cmp::Reverse(item.score));

   // Limit to top 50 results
   filtered.truncate(50);

   filtered
}

pub struct FffSearchState {
   fff: OnceLock<FffSearch>,
   workspace_path: Mutex<Option<PathBuf>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FffScanStatus {
   pub is_scanning: bool,
   pub scanned_files_count: usize,
   pub indexed_files: usize,
   pub is_watcher_ready: bool,
   pub is_warmup_complete: bool,
}

impl FffSearchState {
   pub fn new() -> Self {
      Self {
         fff: OnceLock::new(),
         workspace_path: Mutex::new(None),
      }
   }

   pub(crate) fn get_or_init(&self, app: &AppHandle) -> Result<&FffSearch, String> {
      if let Some(fff) = self.fff.get() {
         return Ok(fff);
      }

      let data_dir = app
         .path()
         .app_data_dir()
         .map_err(|e| format!("app_data_dir: {e}"))?;
      let db_path: PathBuf = data_dir.join("fff-frecency.lmdb");
      let fff = FffSearch::new(db_path).map_err(|e| format!("fff init: {e}"))?;
      let _ = self.fff.set(fff);
      Ok(self.fff.get().unwrap())
   }

   pub(crate) fn ensure_workspace(&self, app: &AppHandle, base_path: &Path) -> Result<(), String> {
      let fff = self.get_or_init(app)?;
      let next_path = base_path.to_path_buf();
      let mut workspace_path = self
         .workspace_path
         .lock()
         .map_err(|e| format!("fff workspace lock: {e}"))?;

      if workspace_path.as_ref() == Some(&next_path) {
         return Ok(());
      }

      fff.set_workspace(base_path)
         .map_err(|e| format!("fff set_workspace: {e}"))?;
      *workspace_path = Some(next_path);
      Ok(())
   }

   pub(crate) fn scan_status(
      &self,
      app: &AppHandle,
      base_path: Option<&Path>,
   ) -> Result<FffScanStatus, String> {
      if let Some(base_path) = base_path {
         self.ensure_workspace(app, base_path)?;
      }

      let fff = self.get_or_init(app)?;
      let picker_guard = fff
         .picker
         .read()
         .map_err(|e| format!("fff picker read: {e}"))?;

      let Some(picker) = picker_guard.as_ref() else {
         return Ok(FffScanStatus {
            is_scanning: false,
            scanned_files_count: 0,
            indexed_files: 0,
            is_watcher_ready: false,
            is_warmup_complete: false,
         });
      };

      let progress = picker.get_scan_progress();
      Ok(FffScanStatus {
         is_scanning: progress.is_scanning,
         scanned_files_count: progress.scanned_files_count,
         indexed_files: picker.get_files().len(),
         is_watcher_ready: progress.is_watcher_ready,
         is_warmup_complete: progress.is_warmup_complete,
      })
   }
}

fn should_skip_fff_path(path: &str) -> bool {
   path.starts_with("remote://") || path.starts_with("diff://") || path.trim().is_empty()
}

#[tauri::command]
pub fn fff_set_workspace(
   app: AppHandle,
   state: State<'_, FffSearchState>,
   base_path: String,
) -> Result<(), String> {
   if should_skip_fff_path(&base_path) {
      return Ok(());
   }

   state.ensure_workspace(&app, Path::new(&base_path))
}

#[tauri::command]
pub fn fff_search_files(
   app: AppHandle,
   state: State<'_, FffSearchState>,
   query: String,
   limit: Option<usize>,
   root_path: Option<String>,
) -> Result<Vec<FffSearchHit>, String> {
   if query.trim().is_empty() {
      return Ok(Vec::new());
   }

   if let Some(root_path) = root_path.as_deref() {
      if should_skip_fff_path(root_path) {
         return Ok(Vec::new());
      }

      state.ensure_workspace(&app, Path::new(root_path))?;
   }

   let fff = state.get_or_init(&app)?;
   fff.search(&query, limit.unwrap_or(100))
      .map_err(|e| format!("fff search: {e}"))
}

#[tauri::command]
pub fn fff_scan_status(
   app: AppHandle,
   state: State<'_, FffSearchState>,
   root_path: String,
) -> Result<FffScanStatus, String> {
   if should_skip_fff_path(&root_path) {
      return Ok(FffScanStatus {
         is_scanning: false,
         scanned_files_count: 0,
         indexed_files: 0,
         is_watcher_ready: false,
         is_warmup_complete: false,
      });
   }

   state.scan_status(&app, Some(Path::new(&root_path)))
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
