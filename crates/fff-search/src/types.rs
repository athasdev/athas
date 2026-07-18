use fff_search::GrepMode;
use serde::Serialize;

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
pub struct FffSearchHit {
   pub path: String,
   pub name: String,
   pub relative_path: String,
   pub score: i32,
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
pub struct FffIndexedFile {
   pub path: String,
   pub name: String,
   pub relative_path: String,
}

#[derive(Debug, Serialize, Clone, Default, PartialEq, Eq)]
pub struct FffScanStatus {
   pub is_scanning: bool,
   pub scanned_files_count: usize,
   pub indexed_files: usize,
   pub is_watcher_ready: bool,
   pub is_warmup_complete: bool,
}

#[derive(Debug, Clone)]
pub struct FffGrepOptions {
   pub pattern: String,
   pub mode: GrepMode,
   pub file_offset: usize,
   pub page_limit: usize,
   pub time_budget_ms: u64,
   pub before_context: usize,
   pub after_context: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FffGrepMatch {
   pub file_path: String,
   pub line_number: usize,
   pub line_content: String,
   pub column: usize,
   pub match_byte_offsets: Vec<(u32, u32)>,
   pub context_before: Vec<String>,
   pub context_after: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FffGrepResult {
   pub matches: Vec<FffGrepMatch>,
   pub total_files: usize,
   pub searched_files: usize,
   pub searchable_files: usize,
   pub files_with_matches: usize,
   pub next_file_offset: usize,
   pub is_indexing: bool,
   pub indexed_files: usize,
   pub regex_fallback_error: Option<String>,
}
