use crate::commands::fuzzy::FffSearchState;
use athas_fff_search::{GrepMode, GrepSearchOptions, parse_grep_query};
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};
use tauri::{AppHandle, State};

const INITIAL_SCAN_WAIT_TIMEOUT: Duration = Duration::from_millis(1500);
const INITIAL_SCAN_WAIT_INTERVAL: Duration = Duration::from_millis(25);

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchMatchRange {
   pub start: usize,
   pub end: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchMatch {
   pub line_number: usize,
   pub line_content: String,
   pub column_start: usize,
   pub column_end: usize,
   pub match_ranges: Vec<SearchMatchRange>,
   pub context_before: Vec<String>,
   pub context_after: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileSearchResult {
   pub file_path: String,
   pub matches: Vec<SearchMatch>,
   pub total_matches: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchFilesRequest {
   pub root_path: String,
   pub query: String,
   pub case_sensitive: Option<bool>,
   pub whole_word: Option<bool>,
   pub use_regex: Option<bool>,
   pub max_results: Option<usize>,
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

#[tauri::command]
pub fn search_files_content(
   app: AppHandle,
   state: State<'_, FffSearchState>,
   request: SearchFilesRequest,
) -> Result<Vec<FileSearchResult>, String> {
   if request.query.trim().is_empty() {
      return Ok(Vec::new());
   }

   state.ensure_workspace(&app, std::path::Path::new(&request.root_path))?;
   let fff = state.get_or_init(&app)?;
   let wait_started = Instant::now();

   while wait_started.elapsed() < INITIAL_SCAN_WAIT_TIMEOUT {
      let is_scanning = {
         let picker_guard = fff
            .picker
            .read()
            .map_err(|e| format!("fff picker read: {e}"))?;

         picker_guard
            .as_ref()
            .map(|picker| picker.get_scan_progress().is_scanning)
            .unwrap_or(false)
      };

      if !is_scanning {
         break;
      }

      std::thread::sleep(INITIAL_SCAN_WAIT_INTERVAL);
   }

   let picker_guard = fff
      .picker
      .read()
      .map_err(|e| format!("fff picker read: {e}"))?;
   let Some(picker) = picker_guard.as_ref() else {
      return Ok(Vec::new());
   };

   let (pattern, mode) = build_fff_grep_pattern(&request);
   let parsed_query = parse_grep_query(&pattern);
   let context_lines = request.context_lines.unwrap_or(0).min(10);
   let grep_result = picker.grep(
      &parsed_query,
      &GrepSearchOptions {
         max_file_size: 1_000_000,
         max_matches_per_file: 50,
         smart_case: false,
         file_offset: 0,
         page_limit: request.max_results.unwrap_or(100).max(1),
         mode,
         time_budget_ms: 250,
         before_context: context_lines,
         after_context: context_lines,
         classify_definitions: false,
      },
   );

   let mut grouped_results: Vec<FileSearchResult> = Vec::new();
   let mut file_index_map: std::collections::HashMap<usize, usize> =
      std::collections::HashMap::new();

   for grep_match in grep_result.matches {
      let Some(file) = grep_result.files.get(grep_match.file_index) else {
         continue;
      };

      let start_end = grep_match
         .match_byte_offsets
         .first()
         .map(|(start, end)| (*start as usize, *end as usize))
         .unwrap_or((grep_match.col, grep_match.col + request.query.len()));
      let match_ranges = grep_match
         .match_byte_offsets
         .iter()
         .map(|(start, end)| SearchMatchRange {
            start: *start as usize,
            end: *end as usize,
         })
         .collect();

      let search_match = SearchMatch {
         line_number: grep_match.line_number as usize,
         line_content: grep_match.line_content,
         column_start: start_end.0,
         column_end: start_end.1,
         match_ranges,
         context_before: grep_match.context_before,
         context_after: grep_match.context_after,
      };

      let grouped_index = if let Some(existing_index) = file_index_map.get(&grep_match.file_index) {
         *existing_index
      } else {
         let index = grouped_results.len();
         grouped_results.push(FileSearchResult {
            file_path: file.path.to_string_lossy().to_string(),
            matches: Vec::new(),
            total_matches: 0,
         });
         file_index_map.insert(grep_match.file_index, index);
         index
      };

      let grouped = &mut grouped_results[grouped_index];
      grouped.matches.push(search_match);
      grouped.total_matches += 1;
   }

   Ok(grouped_results)
}
