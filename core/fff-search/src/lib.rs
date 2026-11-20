use anyhow::{Context, Result};
pub use fff_search::GrepMode;
use fff_search::{
   FileItem, FilePicker, FilePickerOptions, FrecencyTracker, FuzzySearchOptions, GrepSearchOptions,
   PaginationArgs, QueryParser, SharedFilePicker, SharedFrecency, constants::MAX_OVERFLOW_FILES,
   parse_grep_query,
};
mod types;
use std::{
   collections::{HashMap, HashSet},
   path::{Path, PathBuf},
   sync::{Arc, RwLock},
   time::{Duration, Instant},
};
pub use types::*;

#[derive(Clone)]
struct WorkspaceIndex {
   picker: SharedFilePicker,
}

pub struct FffSearch {
   frecency: SharedFrecency,
   watch: bool,
   workspaces: RwLock<HashMap<PathBuf, Arc<WorkspaceIndex>>>,
}

impl FffSearch {
   pub fn new(frecency_db_path: impl Into<PathBuf>) -> Result<Self> {
      let db_path = frecency_db_path.into();
      if let Some(parent) = db_path.parent() {
         std::fs::create_dir_all(parent)
            .with_context(|| format!("creating frecency db dir {parent:?}"))?;
      }

      let frecency = SharedFrecency::default();
      let tracker = FrecencyTracker::open(&db_path)
         .with_context(|| format!("opening frecency db at {db_path:?}"))?;
      frecency
         .init(tracker)
         .context("initializing shared frecency")?;

      // The app's own file watcher feeds every index through `apply_changes`, so fff never
      // starts a second OS watcher over the same tree.
      Ok(Self {
         frecency,
         watch: false,
         workspaces: RwLock::new(HashMap::new()),
      })
   }

   #[doc(hidden)]
   pub fn without_frecency(watch: bool) -> Self {
      Self {
         frecency: SharedFrecency::default(),
         watch,
         workspaces: RwLock::new(HashMap::new()),
      }
   }

   pub fn ensure_workspaces<'a, I>(&self, base_paths: I) -> Result<()>
   where
      I: IntoIterator<Item = &'a Path>,
   {
      for base_path in deduplicate_paths(base_paths) {
         self.ensure_workspace(&base_path)?;
      }
      Ok(())
   }

   pub fn search<'a, I>(
      &self,
      base_paths: I,
      query: &str,
      limit: usize,
   ) -> Result<Vec<FffSearchHit>>
   where
      I: IntoIterator<Item = &'a Path>,
   {
      if query.trim().is_empty() {
         return Ok(Vec::new());
      }

      let workspaces = self.workspace_indexes(base_paths)?;
      let parser = QueryParser::default();
      let parsed = parser.parse(query);
      let per_workspace_limit = limit.max(1);
      let mut hits = Vec::new();

      for workspace in workspaces {
         let guard = workspace.picker.read().context("reading picker")?;
         let Some(picker) = guard.as_ref() else {
            continue;
         };
         let result = picker.fuzzy_search(
            &parsed,
            None,
            FuzzySearchOptions {
               pagination: PaginationArgs {
                  offset: 0,
                  limit: per_workspace_limit,
               },
               ..Default::default()
            },
         );

         hits.extend(
            result
               .items
               .iter()
               .zip(result.scores.iter())
               .map(|(item, score)| FffSearchHit {
                  path: item
                     .absolute_path(picker, picker.base_path())
                     .to_string_lossy()
                     .into_owned(),
                  name: item.file_name(picker),
                  relative_path: item.relative_path(picker),
                  score: score.total,
               }),
         );
      }

      hits.sort_by_key(|hit| std::cmp::Reverse(hit.score));
      let mut seen_paths = HashSet::new();
      hits.retain(|hit| seen_paths.insert(hit.path.clone()));
      hits.truncate(limit.max(1));
      Ok(hits)
   }

   pub fn list_files<'a, I>(&self, base_paths: I) -> Result<Vec<FffIndexedFile>>
   where
      I: IntoIterator<Item = &'a Path>,
   {
      let workspaces = self.workspace_indexes(base_paths)?;
      let mut files = Vec::new();

      for workspace in workspaces {
         let guard = workspace.picker.read().context("reading picker")?;
         let Some(picker) = guard.as_ref() else {
            continue;
         };

         for item in picker.get_files().iter().chain(picker.get_overflow_files()) {
            if !item.is_deleted() {
               files.push(indexed_file(item, picker));
            }
         }
      }

      files.sort_by(|left, right| left.path.cmp(&right.path));
      files.dedup_by(|left, right| left.path == right.path);
      Ok(files)
   }

   pub fn scan_status<'a, I>(&self, base_paths: I) -> Result<FffScanStatus>
   where
      I: IntoIterator<Item = &'a Path>,
   {
      let workspaces = self.workspace_indexes(base_paths)?;
      self.scan_status_for_indexes(&workspaces)
   }

   pub fn wait_for_scan<'a, I>(&self, base_paths: I, timeout: Duration) -> Result<bool>
   where
      I: IntoIterator<Item = &'a Path>,
   {
      let workspaces = self.workspace_indexes(base_paths)?;
      let started_at = Instant::now();

      for workspace in workspaces {
         let Some(remaining) = timeout.checked_sub(started_at.elapsed()) else {
            return Ok(false);
         };
         if !workspace.picker.wait_for_scan(remaining) {
            return Ok(false);
         }
      }
      Ok(true)
   }

   pub fn grep<'a, I>(&self, base_paths: I, options: &FffGrepOptions) -> Result<FffGrepResult>
   where
      I: IntoIterator<Item = &'a Path>,
   {
      let workspaces = self.workspace_indexes(base_paths)?;
      let status = self.scan_status_for_indexes(&workspaces)?;
      if status.is_scanning {
         return Ok(FffGrepResult {
            total_files: status.indexed_files,
            is_indexing: true,
            indexed_files: status.indexed_files,
            ..Default::default()
         });
      }

      let parsed_query = parse_grep_query(&options.pattern);
      let started_at = Instant::now();
      let mut response = FffGrepResult {
         indexed_files: status.indexed_files,
         ..Default::default()
      };
      let mut remaining_offset = options.file_offset;
      let mut searchable_prefix = 0;
      let mut matched_paths = HashSet::new();

      for (workspace_index, workspace) in workspaces.iter().enumerate() {
         let guard = workspace.picker.read().context("reading picker")?;
         let Some(picker) = guard.as_ref() else {
            continue;
         };
         let remaining_limit = options.page_limit.saturating_sub(response.matches.len());
         let should_search = remaining_limit > 0
            && (options.time_budget_ms == 0
               || started_at.elapsed().as_millis() < options.time_budget_ms as u128);
         let time_budget_ms = if options.time_budget_ms == 0 {
            0
         } else {
            options
               .time_budget_ms
               .saturating_sub(started_at.elapsed().as_millis() as u64)
         };
         let local_offset = if should_search {
            remaining_offset
         } else {
            usize::MAX
         };
         let result = picker.grep(
            &parsed_query,
            &GrepSearchOptions {
               max_file_size: u64::MAX,
               max_matches_per_file: usize::MAX,
               smart_case: false,
               file_offset: local_offset,
               page_limit: remaining_limit.max(1),
               mode: options.mode,
               time_budget_ms,
               before_context: options.before_context,
               after_context: options.after_context,
               classify_definitions: false,
               ..Default::default()
            },
         );

         response.total_files += result.total_files;
         response.searchable_files += result.filtered_file_count;
         response.searched_files += result.total_files_searched;
         if response.regex_fallback_error.is_none() {
            response.regex_fallback_error = result.regex_fallback_error.clone();
         }

         if remaining_offset >= result.filtered_file_count {
            remaining_offset -= result.filtered_file_count;
            searchable_prefix += result.filtered_file_count;
            continue;
         }

         if should_search {
            for grep_match in result.matches {
               let Some(file) = result.files.get(grep_match.file_index) else {
                  continue;
               };
               let file_path = file
                  .absolute_path(picker, picker.base_path())
                  .to_string_lossy()
                  .into_owned();
               matched_paths.insert(file_path.clone());
               response.matches.push(FffGrepMatch {
                  file_path,
                  line_number: grep_match.line_number as usize,
                  line_content: grep_match.line_content,
                  column: grep_match.col,
                  match_byte_offsets: grep_match.match_byte_offsets.into_vec(),
                  context_before: grep_match.context_before,
                  context_after: grep_match.context_after,
               });
            }
         }

         let has_later_workspace = workspace_index + 1 < workspaces.len();
         if result.next_file_offset > 0 {
            response.next_file_offset = searchable_prefix + result.next_file_offset;
         } else if !should_search && remaining_limit > 0 && response.next_file_offset == 0 {
            response.next_file_offset = searchable_prefix + remaining_offset;
         } else if response.matches.len() >= options.page_limit && has_later_workspace {
            response.next_file_offset = searchable_prefix + result.filtered_file_count;
         }

         searchable_prefix += result.filtered_file_count;
         remaining_offset = 0;
      }

      response.files_with_matches = matched_paths.len();
      Ok(response)
   }

   /// Folds a batch of filesystem changes under `base_path` into its index, the job fff's own
   /// watcher does when it runs. Roots that were never indexed are skipped. Falls back to a full
   /// rescan when events were lost, ignore rules changed, or the index's overflow area fills up.
   pub fn apply_changes(
      &self,
      base_path: &Path,
      changes: &[FffFsChange],
      rescan: bool,
      git_changed: bool,
   ) -> Result<()> {
      let Some(workspace) = self
         .workspaces
         .read()
         .map_err(|error| anyhow::anyhow!("reading workspace indexes: {error}"))?
         .get(base_path)
         .cloned()
      else {
         return Ok(());
      };

      let ignore_rules_changed = changes.iter().any(|change| {
         matches!(
            change.path.file_name().and_then(|name| name.to_str()),
            Some(".gitignore" | ".ignore")
         )
      });
      let mut needs_rescan = rescan || ignore_rules_changed;
      let mut git_paths = Vec::new();

      if !needs_rescan {
         let mut guard = workspace.picker.write().context("writing picker")?;
         let Some(picker) = guard.as_mut() else {
            return Ok(());
         };

         if picker.is_scan_active() {
            // Changes landing mid-scan may miss the walker; let the scan run again afterwards.
            needs_rescan = true;
         } else {
            let picker_base = picker.base_path().to_path_buf();
            let to_picker_path = |path: &Path| match path.strip_prefix(base_path) {
               Ok(relative) => picker_base.join(relative),
               Err(_) => path.to_path_buf(),
            };

            for change in changes {
               let path = to_picker_path(&change.path);
               if change.removed {
                  if !picker.remove_file_by_path(&path) {
                     picker.remove_all_files_in_dir(&path);
                  }
               } else if change.is_dir {
                  let Some(files) = files_in_new_directory(&path) else {
                     needs_rescan = true;
                     break;
                  };
                  for file in files {
                     if picker.handle_create_or_modify(&file).is_none() {
                        needs_rescan = true;
                        break;
                     }
                     git_paths.push(file);
                  }
               } else if picker.handle_create_or_modify(&path).is_some() {
                  git_paths.push(path);
               } else {
                  needs_rescan = true;
               }

               if needs_rescan {
                  break;
               }
            }

            needs_rescan |= picker.get_overflow_files().len() > MAX_OVERFLOW_FILES;
         }
      }

      if needs_rescan {
         workspace
            .picker
            .trigger_full_rescan_async(&self.frecency)
            .context("rescanning workspace index")?;
         return Ok(());
      }

      if git_changed {
         workspace
            .picker
            .refresh_git_status(&self.frecency)
            .context("refreshing git status")?;
      } else if !git_paths.is_empty() {
         workspace
            .picker
            .update_git_status_for_paths(&git_paths, &self.frecency)
            .context("updating git status")?;
      }
      Ok(())
   }

   pub fn track_access(&self, path: &Path) -> Result<()> {
      let guard = self.frecency.read().context("reading frecency")?;
      if let Some(tracker) = guard.as_ref() {
         tracker.track_access(path).context("tracking file access")?;
      }
      Ok(())
   }

   #[doc(hidden)]
   pub fn indexed_workspace_count(&self) -> Result<usize> {
      Ok(self
         .workspaces
         .read()
         .map_err(|error| anyhow::anyhow!("reading workspace indexes: {error}"))?
         .len())
   }

   fn ensure_workspace(&self, base_path: &Path) -> Result<Arc<WorkspaceIndex>> {
      if let Some(workspace) = self
         .workspaces
         .read()
         .map_err(|error| anyhow::anyhow!("reading workspace indexes: {error}"))?
         .get(base_path)
         .cloned()
      {
         return Ok(workspace);
      }

      let mut workspaces = self
         .workspaces
         .write()
         .map_err(|error| anyhow::anyhow!("writing workspace indexes: {error}"))?;
      if let Some(workspace) = workspaces.get(base_path).cloned() {
         return Ok(workspace);
      }

      let picker = SharedFilePicker::default();
      FilePicker::new_with_shared_state(
         picker.clone(),
         self.frecency.clone(),
         FilePickerOptions {
            base_path: base_path.to_string_lossy().into_owned(),
            watch: self.watch,
            enable_home_dir_scanning: true,
            ..Default::default()
         },
      )
      .with_context(|| format!("initializing fff FilePicker for {base_path:?}"))?;

      let workspace = Arc::new(WorkspaceIndex { picker });
      workspaces.insert(base_path.to_path_buf(), workspace.clone());
      Ok(workspace)
   }

   fn workspace_indexes<'a, I>(&self, base_paths: I) -> Result<Vec<Arc<WorkspaceIndex>>>
   where
      I: IntoIterator<Item = &'a Path>,
   {
      deduplicate_paths(base_paths)
         .iter()
         .map(|path| self.ensure_workspace(path))
         .collect()
   }

   fn scan_status_for_indexes(&self, workspaces: &[Arc<WorkspaceIndex>]) -> Result<FffScanStatus> {
      if workspaces.is_empty() {
         return Ok(FffScanStatus::default());
      }

      let mut status = FffScanStatus {
         is_watcher_ready: true,
         is_warmup_complete: true,
         ..Default::default()
      };
      for workspace in workspaces {
         let guard = workspace.picker.read().context("reading picker")?;
         let Some(picker) = guard.as_ref() else {
            status.is_watcher_ready = false;
            status.is_warmup_complete = false;
            continue;
         };
         let progress = picker.get_scan_progress();
         status.is_scanning |= progress.is_scanning;
         status.scanned_files_count += progress.scanned_files_count;
         status.indexed_files += picker.live_file_count();
         // Without fff's own watcher the index is kept current by `apply_changes`.
         status.is_watcher_ready &= !self.watch || progress.is_watcher_ready;
         status.is_warmup_complete &= progress.is_warmup_complete;
      }
      Ok(status)
   }
}

fn deduplicate_paths<'a, I>(base_paths: I) -> Vec<PathBuf>
where
   I: IntoIterator<Item = &'a Path>,
{
   let mut seen = HashSet::new();
   base_paths
      .into_iter()
      .filter(|path| !path.as_os_str().is_empty())
      .filter_map(|path| {
         let path = path.to_path_buf();
         seen.insert(path.clone()).then_some(path)
      })
      .collect()
}

/// Files under a directory that appeared in one piece (created or moved in), honouring ignore
/// files. `None` when there are too many to add one by one and a rescan is cheaper.
fn files_in_new_directory(directory: &Path) -> Option<Vec<PathBuf>> {
   let mut files = Vec::new();
   for entry in ignore::WalkBuilder::new(directory)
      .hidden(false)
      .require_git(false)
      .build()
      .flatten()
   {
      if entry.file_type().is_some_and(|kind| kind.is_file()) {
         if files.len() >= MAX_OVERFLOW_FILES {
            return None;
         }
         files.push(entry.into_path());
      }
   }
   Some(files)
}

fn indexed_file(item: &FileItem, picker: &FilePicker) -> FffIndexedFile {
   FffIndexedFile {
      path: item
         .absolute_path(picker, picker.base_path())
         .to_string_lossy()
         .into_owned(),
      name: item.file_name(picker),
      relative_path: item.relative_path(picker),
   }
}
