use crate::{app_runtime::AppHandle, commands::fuzzy::FffSearchState};
use athas_fff_search::{GrepMode, GrepSearchOptions, parse_grep_query};
use serde::{Deserialize, Serialize};
use tauri::State;

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
pub struct SearchFilesResponse {
   pub results: Vec<FileSearchResult>,
   pub total_files: usize,
   pub searched_files: usize,
   pub searchable_files: usize,
   pub files_with_matches: usize,
   pub next_file_offset: usize,
   pub has_more: bool,
   pub is_indexing: bool,
   pub indexed_files: usize,
   pub regex_fallback_error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchFilesRequest {
   pub root_path: String,
   pub query: String,
   pub case_sensitive: Option<bool>,
   pub whole_word: Option<bool>,
   pub use_regex: Option<bool>,
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

fn should_skip_fff_path(path: &str) -> bool {
   path.starts_with("remote://")
      || path.starts_with("wsl://")
      || path.starts_with("diff://")
      || path.trim().is_empty()
}

fn empty_search_response(is_indexing: bool, indexed_files: usize) -> SearchFilesResponse {
   SearchFilesResponse {
      results: Vec::new(),
      total_files: indexed_files,
      searched_files: 0,
      searchable_files: 0,
      files_with_matches: 0,
      next_file_offset: 0,
      has_more: false,
      is_indexing,
      indexed_files,
      regex_fallback_error: None,
   }
}

fn byte_offset_to_char_offset(text: &str, byte_offset: usize) -> usize {
   if byte_offset >= text.len() {
      return text.chars().count();
   }

   text
      .char_indices()
      .take_while(|(index, _)| *index < byte_offset)
      .count()
}

fn byte_range_to_char_range(text: &str, start: usize, end: usize) -> (usize, usize) {
   let char_start = byte_offset_to_char_offset(text, start);
   let char_end = byte_offset_to_char_offset(text, end);
   (char_start, char_end.max(char_start + 1))
}

#[tauri::command]
pub fn search_files_content(
   app: AppHandle,
   state: State<'_, FffSearchState>,
   request: SearchFilesRequest,
) -> Result<SearchFilesResponse, String> {
   if request.query.trim().is_empty() || should_skip_fff_path(&request.root_path) {
      return Ok(empty_search_response(false, 0));
   }

   let _operation_guard = state.lock_operation()?;
   state.ensure_workspace(&app, std::path::Path::new(&request.root_path))?;
   let fff = state.get_or_init(&app)?;

   let picker_guard = fff
      .picker
      .read()
      .map_err(|e| format!("fff picker read: {e}"))?;
   let Some(picker) = picker_guard.as_ref() else {
      return Ok(empty_search_response(false, 0));
   };

   let scan_progress = picker.get_scan_progress();
   if scan_progress.is_scanning {
      return Ok(empty_search_response(
         true,
         scan_progress.scanned_files_count,
      ));
   }

   let (pattern, mode) = build_fff_grep_pattern(&request);
   let parsed_query = parse_grep_query(&pattern);
   let context_lines = request.context_lines.unwrap_or(0).min(10);
   let grep_result = picker.grep(
      &parsed_query,
      &GrepSearchOptions {
         max_file_size: u64::MAX,
         max_matches_per_file: usize::MAX,
         smart_case: false,
         file_offset: request.file_offset.unwrap_or(0),
         page_limit: request.max_results.unwrap_or(100).max(1),
         mode,
         time_budget_ms: 120,
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

      let line_content = grep_match.line_content;
      let start_end_bytes = grep_match
         .match_byte_offsets
         .first()
         .map(|(start, end)| (*start as usize, *end as usize))
         .unwrap_or((grep_match.col, grep_match.col + request.query.len()));
      let start_end = byte_range_to_char_range(&line_content, start_end_bytes.0, start_end_bytes.1);
      let match_ranges = grep_match
         .match_byte_offsets
         .iter()
         .map(|(start, end)| {
            let (start, end) =
               byte_range_to_char_range(&line_content, *start as usize, *end as usize);
            SearchMatchRange { start, end }
         })
         .collect();

      let search_match = SearchMatch {
         line_number: grep_match.line_number as usize,
         line_content,
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

   Ok(SearchFilesResponse {
      results: grouped_results,
      total_files: grep_result.total_files,
      searched_files: grep_result.total_files_searched,
      searchable_files: grep_result.filtered_file_count,
      files_with_matches: grep_result.files_with_matches,
      next_file_offset: grep_result.next_file_offset,
      has_more: grep_result.next_file_offset > 0,
      is_indexing: false,
      indexed_files: grep_result.total_files,
      regex_fallback_error: grep_result.regex_fallback_error,
   })
}

#[cfg(test)]
mod tests {
   use super::*;

   fn request(query: &str) -> SearchFilesRequest {
      SearchFilesRequest {
         root_path: "/project".to_string(),
         query: query.to_string(),
         case_sensitive: Some(true),
         whole_word: Some(false),
         use_regex: Some(false),
         max_results: None,
         file_offset: None,
         context_lines: None,
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
   fn converts_utf8_byte_ranges_to_character_ranges() {
      assert_eq!(byte_range_to_char_range("aé日z", 1, 6), (1, 3));
   }

   #[test]
   fn rejects_virtual_and_empty_search_roots() {
      assert!(should_skip_fff_path("remote://host/project"));
      assert!(should_skip_fff_path("wsl://Ubuntu/project"));
      assert!(should_skip_fff_path("diff://change"));
      assert!(should_skip_fff_path("  "));
      assert!(!should_skip_fff_path("/project"));
   }
}
