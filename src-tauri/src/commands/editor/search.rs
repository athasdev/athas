use crate::commands::{
   fuzzy::{FffSearchState, local_workspace_paths},
   ipc_streams::{IpcStreamToken, IpcStreams},
};
use athas_fff_search::{FffGrepMatch, FffGrepOptions, FffSearch, GrepMode};
use serde::{Deserialize, Serialize};
use std::{
   collections::HashMap,
   path::PathBuf,
   time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, ipc::Channel};

/// Matches requested from the index per batch sent to the webview.
const STREAM_BATCH_MATCHES: usize = 200;
/// Matches one stream sends before it stops and reports where to continue.
const DEFAULT_STREAM_MATCH_LIMIT: usize = 1000;
/// Time one index page may spend before it returns what it has.
const PAGE_TIME_BUDGET_MS: u64 = 120;
/// How often progress is reported while indexing or while pages find nothing.
const PROGRESS_INTERVAL: Duration = Duration::from_millis(150);

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct SearchMatchRange {
   pub start: usize,
   pub end: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct SearchMatch {
   pub line_number: usize,
   pub line_content: String,
   pub column_start: usize,
   pub column_end: usize,
   pub match_ranges: Vec<SearchMatchRange>,
   pub context_before: Vec<String>,
   pub context_after: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct FileSearchResult {
   pub file_path: String,
   pub matches: Vec<SearchMatch>,
   pub total_matches: usize,
}

#[derive(Debug, Default, Serialize, Deserialize, Clone, PartialEq, Eq, specta::Type)]
pub struct ContentSearchSummary {
   pub total_files: usize,
   pub searched_files: usize,
   pub searchable_files: usize,
   pub next_file_offset: usize,
   pub has_more: bool,
   pub indexed_files: usize,
   pub regex_fallback_error: Option<String>,
   pub cancelled: bool,
}

/// One message of a streamed content search, in the order the webview receives them.
#[derive(Debug, Serialize, specta::Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ContentSearchEvent {
   /// The workspace index is still being built; the search starts once it is ready.
   Indexing {
      scanned_files: usize,
      indexed_files: usize,
   },
   /// Matches found since the previous batch, with cumulative progress.
   Results {
      results: Vec<FileSearchResult>,
      searched_files: usize,
      searchable_files: usize,
   },
   /// The last message: the search finished, used its match budget, or was cancelled.
   Done { summary: ContentSearchSummary },
}

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct SearchFilesRequest {
   /// Names the stream so the webview can cancel it with `cancel_ipc_stream`.
   pub search_id: String,
   pub root_paths: Vec<String>,
   pub query: String,
   pub case_sensitive: Option<bool>,
   pub whole_word: Option<bool>,
   pub use_regex: Option<bool>,
   /// Matches to send before stopping with `has_more`.
   pub max_results: Option<usize>,
   pub file_offset: Option<usize>,
   pub context_lines: Option<usize>,
}

fn build_fff_grep_pattern(request: &SearchFilesRequest) -> (String, GrepMode) {
   let case_sensitive = request.case_sensitive.unwrap_or(false);
   let whole_word = request.whole_word.unwrap_or(false);
   let use_regex = request.use_regex.unwrap_or(false);

   let base_pattern = if use_regex {
      request.query.clone()
   } else {
      regex::escape(&request.query)
   };

   let with_boundaries = if whole_word {
      format!(r"\b(?:{})\b", base_pattern)
   } else {
      base_pattern
   };

   let final_pattern = if case_sensitive {
      with_boundaries
   } else {
      format!("(?i:{with_boundaries})")
   };

   let mode = if use_regex || whole_word || !case_sensitive {
      GrepMode::Regex
   } else {
      GrepMode::PlainText
   };

   (final_pattern, mode)
}

fn byte_offset_to_utf16_offset(text: &str, byte_offset: usize) -> usize {
   if byte_offset >= text.len() {
      return text.encode_utf16().count();
   }

   text
      .char_indices()
      .take_while(|(index, _)| *index < byte_offset)
      .map(|(_, character)| character.len_utf16())
      .sum()
}

fn byte_range_to_utf16_range(text: &str, start: usize, end: usize) -> (usize, usize) {
   let char_start = byte_offset_to_utf16_offset(text, start);
   let char_end = byte_offset_to_utf16_offset(text, end);
   (char_start, char_end.max(char_start))
}

/// Groups one page of index matches by file, converting byte ranges to the
/// editor's UTF-16 columns.
fn group_matches(matches: Vec<FffGrepMatch>, query_len: usize) -> Vec<FileSearchResult> {
   let mut grouped_results: Vec<FileSearchResult> = Vec::new();
   let mut file_index_map: HashMap<String, usize> = HashMap::new();

   for grep_match in matches {
      let line_content = grep_match.line_content;
      let start_end_bytes = grep_match
         .match_byte_offsets
         .first()
         .map(|(start, end)| (*start as usize, *end as usize))
         .unwrap_or((grep_match.column, grep_match.column + query_len));
      let start_end =
         byte_range_to_utf16_range(&line_content, start_end_bytes.0, start_end_bytes.1);
      let match_ranges = grep_match
         .match_byte_offsets
         .iter()
         .map(|(start, end)| {
            let (start, end) =
               byte_range_to_utf16_range(&line_content, *start as usize, *end as usize);
            SearchMatchRange { start, end }
         })
         .collect();

      let search_match = SearchMatch {
         line_number: grep_match.line_number,
         line_content,
         column_start: start_end.0,
         column_end: start_end.1,
         match_ranges,
         context_before: grep_match.context_before,
         context_after: grep_match.context_after,
      };

      let grouped_index = if let Some(existing_index) = file_index_map.get(&grep_match.file_path) {
         *existing_index
      } else {
         let index = grouped_results.len();
         grouped_results.push(FileSearchResult {
            file_path: grep_match.file_path.clone(),
            matches: Vec::new(),
            total_matches: 0,
         });
         file_index_map.insert(grep_match.file_path, index);
         index
      };

      let grouped = &mut grouped_results[grouped_index];
      grouped.matches.push(search_match);
      grouped.total_matches += 1;
   }

   grouped_results
}

/// Waits for the workspace index while reporting its progress. Returns `false`
/// when the search was cancelled first.
fn wait_for_index(
   fff: &FffSearch,
   root_paths: &[PathBuf],
   is_cancelled: &dyn Fn() -> bool,
   emit: &mut dyn FnMut(ContentSearchEvent) -> Result<(), String>,
) -> Result<bool, String> {
   loop {
      let status = fff
         .scan_status(root_paths.iter().map(PathBuf::as_path))
         .map_err(|error| format!("fff scan_status: {error}"))?;
      if !status.is_scanning {
         return Ok(true);
      }
      if is_cancelled() {
         return Ok(false);
      }
      emit(ContentSearchEvent::Indexing {
         scanned_files: status.scanned_files_count,
         indexed_files: status.indexed_files,
      })?;
      fff.wait_for_scan(root_paths.iter().map(PathBuf::as_path), PROGRESS_INTERVAL)
         .map_err(|error| format!("fff wait_for_scan: {error}"))?;
   }
}

/// Pages through the index and emits each page's matches as soon as it is read,
/// ending with a single `Done` event.
fn run_content_search(
   fff: &FffSearch,
   root_paths: &[PathBuf],
   request: &SearchFilesRequest,
   batch_matches: usize,
   is_cancelled: &dyn Fn() -> bool,
   emit: &mut dyn FnMut(ContentSearchEvent) -> Result<(), String>,
) -> Result<(), String> {
   let (pattern, mode) = build_fff_grep_pattern(request);
   let context_lines = request.context_lines.unwrap_or(0).min(10);
   let match_limit = request
      .max_results
      .unwrap_or(DEFAULT_STREAM_MATCH_LIMIT)
      .max(1);
   let mut summary = ContentSearchSummary::default();
   let mut file_offset = request.file_offset.unwrap_or(0);
   let mut matches_sent = 0;
   let mut last_emit = Instant::now();

   loop {
      if is_cancelled() {
         summary.cancelled = true;
         break;
      }

      let page = fff
         .grep(
            root_paths.iter().map(PathBuf::as_path),
            &FffGrepOptions {
               pattern: pattern.clone(),
               mode,
               file_offset,
               page_limit: (match_limit - matches_sent).min(batch_matches.max(1)),
               time_budget_ms: PAGE_TIME_BUDGET_MS,
               before_context: context_lines,
               after_context: context_lines,
            },
         )
         .map_err(|error| format!("fff grep: {error}"))?;

      if page.is_indexing {
         if wait_for_index(fff, root_paths, is_cancelled, emit)? {
            continue;
         }
         summary.cancelled = true;
         break;
      }

      summary.total_files = page.total_files;
      summary.indexed_files = page.indexed_files;
      summary.searchable_files = page.searchable_files;
      summary.searched_files += page.searched_files;
      if summary.regex_fallback_error.is_none() {
         summary.regex_fallback_error = page.regex_fallback_error;
      }

      matches_sent += page.matches.len();
      let results = group_matches(page.matches, request.query.len());
      if !results.is_empty() || last_emit.elapsed() >= PROGRESS_INTERVAL {
         emit(ContentSearchEvent::Results {
            results,
            searched_files: summary.searched_files,
            searchable_files: summary.searchable_files,
         })?;
         last_emit = Instant::now();
      }

      if page.next_file_offset == 0 {
         break;
      }
      if page.next_file_offset <= file_offset {
         return Err("Search pagination did not advance. Refresh the search to try again.".into());
      }
      file_offset = page.next_file_offset;
      if matches_sent >= match_limit {
         summary.has_more = true;
         summary.next_file_offset = file_offset;
         break;
      }
   }

   emit(ContentSearchEvent::Done { summary })
}

fn stream_content_search(
   app: &AppHandle,
   request: &SearchFilesRequest,
   token: &IpcStreamToken,
   channel: &Channel<ContentSearchEvent>,
) -> Result<(), String> {
   let mut emit = |event: ContentSearchEvent| {
      channel
         .send(event)
         .map_err(|error| format!("search channel: {error}"))
   };
   let root_paths = local_workspace_paths(request.root_paths.clone());
   if request.query.trim().is_empty() || root_paths.is_empty() {
      return emit(ContentSearchEvent::Done {
         summary: ContentSearchSummary::default(),
      });
   }

   let state = app.state::<FffSearchState>();
   state.ensure_workspaces(app, &root_paths)?;
   let fff = state.get_or_init(app)?;
   run_content_search(
      fff,
      &root_paths,
      request,
      STREAM_BATCH_MATCHES,
      &|| token.is_cancelled(),
      &mut emit,
   )
}

/// Streams content search matches over `on_event` as the index is read, instead of
/// returning fixed pages. Waits for indexing in the backend and reports its progress
/// on the same channel. Cancel with `cancel_ipc_stream(request.search_id)`.
#[tauri::command]
#[specta::specta]
pub async fn search_files_content_stream(
   app: AppHandle,
   request: SearchFilesRequest,
   on_event: Channel<ContentSearchEvent>,
) -> Result<(), String> {
   tauri::async_runtime::spawn_blocking(move || {
      let streams = app.state::<IpcStreams>();
      let token = streams.start(&request.search_id);
      let result = stream_content_search(&app, &request, &token, &on_event);
      streams.finish(&request.search_id, &token);
      result
   })
   .await
   .map_err(|error| format!("Search task failed: {error}"))?
}

#[cfg(test)]
mod tests {
   use super::*;
   use std::{fs, sync::Mutex};
   use tempfile::TempDir;

   static FFF_TEST_LOCK: Mutex<()> = Mutex::new(());

   fn request(query: &str) -> SearchFilesRequest {
      SearchFilesRequest {
         search_id: "search-1".to_string(),
         root_paths: vec!["/project".to_string()],
         query: query.to_string(),
         case_sensitive: Some(true),
         whole_word: Some(false),
         use_regex: Some(false),
         max_results: None,
         file_offset: None,
         context_lines: None,
      }
   }

   fn indexed_workspace(files: &[(&str, &str)]) -> (TempDir, FffSearch, Vec<PathBuf>) {
      let temp_dir = TempDir::new().unwrap();
      for (name, content) in files {
         fs::write(temp_dir.path().join(name), content).unwrap();
      }
      let search = FffSearch::without_frecency(false);
      let roots = vec![temp_dir.path().to_path_buf()];
      search
         .ensure_workspaces(roots.iter().map(PathBuf::as_path))
         .unwrap();
      assert!(
         search
            .wait_for_scan(roots.iter().map(PathBuf::as_path), Duration::from_secs(5))
            .unwrap()
      );
      (temp_dir, search, roots)
   }

   fn collect(
      search: &FffSearch,
      roots: &[PathBuf],
      request: &SearchFilesRequest,
      batch_matches: usize,
      cancelled: bool,
   ) -> Vec<ContentSearchEvent> {
      let mut events = Vec::new();
      run_content_search(
         search,
         roots,
         request,
         batch_matches,
         &|| cancelled,
         &mut |event| {
            events.push(event);
            Ok(())
         },
      )
      .unwrap();
      events
   }

   fn result_paths(events: &[ContentSearchEvent]) -> Vec<String> {
      events
         .iter()
         .flat_map(|event| match event {
            ContentSearchEvent::Results { results, .. } => results
               .iter()
               .map(|result| result.file_path.clone())
               .collect(),
            _ => Vec::new(),
         })
         .collect()
   }

   fn summary(events: &[ContentSearchEvent]) -> &ContentSearchSummary {
      match events.last() {
         Some(ContentSearchEvent::Done { summary }) => summary,
         other => panic!("stream did not end with Done: {other:?}"),
      }
   }

   #[test]
   fn keeps_case_sensitive_literals_on_the_plain_text_path() {
      let (pattern, mode) = build_fff_grep_pattern(&request("needle"));

      assert_eq!(pattern, "needle");
      assert!(matches!(mode, GrepMode::PlainText));
   }

   #[test]
   fn escapes_literals_before_adding_case_insensitive_regex_flags() {
      let mut search_request = request("value.*");
      search_request.case_sensitive = Some(false);
      let (pattern, mode) = build_fff_grep_pattern(&search_request);

      assert_eq!(pattern, r"(?i:value\.\*)");
      assert!(matches!(mode, GrepMode::Regex));
   }

   #[test]
   fn converts_utf8_byte_ranges_to_editor_utf16_ranges() {
      assert_eq!(byte_range_to_utf16_range("aé日z", 1, 6), (1, 3));
   }

   #[test]
   fn converts_search_ranges_after_astral_characters_to_editor_utf16_columns() {
      assert_eq!(byte_range_to_utf16_range("😀foo", 4, 7), (2, 5));
      assert_eq!(byte_range_to_utf16_range("a😀foo", 5, 8), (3, 6));
      assert_eq!(byte_offset_to_utf16_offset("😀", 100), 2);
   }

   #[test]
   fn preserves_zero_width_search_ranges_for_replacement() {
      assert_eq!(byte_range_to_utf16_range("😀foo", 4, 4), (2, 2));
   }

   #[test]
   fn rejects_virtual_and_empty_search_roots() {
      let paths = local_workspace_paths(vec![
         "remote://host/project".to_string(),
         "wsl://Ubuntu/project".to_string(),
         "diff://change".to_string(),
         "  ".to_string(),
         "/project".to_string(),
      ]);
      assert_eq!(paths, vec![std::path::PathBuf::from("/project")]);
   }

   #[test]
   fn groups_a_page_of_matches_by_file_with_utf16_columns() {
      let grep_match =
         |file: &str, line: usize, content: &str, start: u32, end: u32| FffGrepMatch {
            file_path: file.to_string(),
            line_number: line,
            line_content: content.to_string(),
            column: start as usize,
            match_byte_offsets: vec![(start, end)],
            context_before: Vec::new(),
            context_after: Vec::new(),
         };
      let results = group_matches(
         vec![
            grep_match("/w/a.rs", 1, "é needle", 3, 9),
            grep_match("/w/b.rs", 4, "needle", 0, 6),
            grep_match("/w/a.rs", 7, "needle", 0, 6),
         ],
         6,
      );

      assert_eq!(results.len(), 2);
      assert_eq!(results[0].file_path, "/w/a.rs");
      assert_eq!(results[0].total_matches, 2);
      assert_eq!(results[0].matches[0].column_start, 2);
      assert_eq!(results[0].matches[0].column_end, 8);
      assert_eq!(results[1].file_path, "/w/b.rs");
   }

   #[test]
   fn streams_matches_in_batches_and_ends_with_a_summary() {
      let _guard = FFF_TEST_LOCK
         .lock()
         .unwrap_or_else(|error| error.into_inner());
      let (_temp_dir, search, roots) = indexed_workspace(&[
         ("a.txt", "needle one\nneedle two\n"),
         ("b.txt", "needle three\n"),
         ("c.txt", "no match here\n"),
      ]);

      let events = collect(&search, &roots, &request("needle"), 1, false);

      let mut paths = result_paths(&events);
      paths.sort();
      paths.dedup();
      assert_eq!(paths.len(), 2);
      assert!(
         events
            .iter()
            .filter(|event| matches!(event, ContentSearchEvent::Results { .. }))
            .count()
            >= 2
      );
      let summary = summary(&events);
      assert!(!summary.has_more);
      assert!(!summary.cancelled);
      assert_eq!(summary.next_file_offset, 0);
      assert_eq!(summary.searchable_files, 3);
   }

   #[test]
   fn stops_at_the_match_budget_and_resumes_from_the_reported_offset() {
      let _guard = FFF_TEST_LOCK
         .lock()
         .unwrap_or_else(|error| error.into_inner());
      let (_temp_dir, search, roots) = indexed_workspace(&[
         ("a.txt", "needle\n"),
         ("b.txt", "needle\n"),
         ("c.txt", "needle\n"),
      ]);
      let mut first_request = request("needle");
      first_request.max_results = Some(1);

      let first = collect(&search, &roots, &first_request, 10, false);
      let first_summary = summary(&first).clone();
      assert!(first_summary.has_more);
      assert!(first_summary.next_file_offset > 0);

      let mut rest_request = request("needle");
      rest_request.file_offset = Some(first_summary.next_file_offset);
      let rest = collect(&search, &roots, &rest_request, 10, false);

      let mut paths = result_paths(&first);
      paths.extend(result_paths(&rest));
      paths.sort();
      paths.dedup();
      assert_eq!(paths.len(), 3);
      assert!(!summary(&rest).has_more);
   }

   #[test]
   fn a_cancelled_search_sends_only_a_cancelled_summary() {
      let _guard = FFF_TEST_LOCK
         .lock()
         .unwrap_or_else(|error| error.into_inner());
      let (_temp_dir, search, roots) = indexed_workspace(&[("a.txt", "needle\n")]);

      let events = collect(&search, &roots, &request("needle"), 10, true);

      assert_eq!(events.len(), 1);
      assert!(summary(&events).cancelled);
   }
}
