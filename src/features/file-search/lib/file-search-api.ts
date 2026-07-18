import { invoke } from "@tauri-apps/api/core";

export interface SearchMatchRange {
  start: number;
  end: number;
}

export interface SearchMatch {
  line_number: number;
  line_content: string;
  column_start: number;
  column_end: number;
  match_ranges?: SearchMatchRange[];
  context_before?: string[];
  context_after?: string[];
}

export interface FileSearchResult {
  file_path: string;
  matches: SearchMatch[];
  total_matches: number;
}

export interface SearchFilesResponse {
  results: FileSearchResult[];
  total_files: number;
  searched_files: number;
  searchable_files: number;
  files_with_matches: number;
  next_file_offset: number;
  has_more: boolean;
  is_indexing: boolean;
  indexed_files: number;
  regex_fallback_error?: string | null;
}

export interface SearchFilesRequest {
  root_paths: string[];
  query: string;
  case_sensitive?: boolean;
  whole_word?: boolean;
  use_regex?: boolean;
  max_results?: number;
  file_offset?: number;
  context_lines?: number;
}

export interface FffSearchHit {
  path: string;
  name: string;
  relative_path: string;
  score: number;
}

export interface FffIndexedFile {
  path: string;
  name: string;
  relative_path: string;
}

export interface FffScanStatus {
  is_scanning: boolean;
  scanned_files_count: number;
  indexed_files: number;
  is_watcher_ready: boolean;
  is_warmup_complete: boolean;
}

export async function searchFilesContent(
  request: SearchFilesRequest,
): Promise<SearchFilesResponse> {
  return invoke<SearchFilesResponse>("search_files_content", { request });
}

export async function fffEnsureWorkspaces(rootPaths: readonly string[]): Promise<void> {
  return invoke("fff_ensure_workspaces", { rootPaths });
}

export async function fffScanStatus(rootPaths: readonly string[]): Promise<FffScanStatus> {
  return invoke<FffScanStatus>("fff_scan_status", { rootPaths });
}

export async function fffSearchFiles(
  query: string,
  rootPaths: readonly string[],
  limit = 100,
): Promise<FffSearchHit[]> {
  return invoke<FffSearchHit[]>("fff_search_files", { query, limit, rootPaths });
}

export async function fffListFiles(rootPaths: readonly string[]): Promise<FffIndexedFile[]> {
  return invoke<FffIndexedFile[]>("fff_list_files", { rootPaths });
}

export async function fffTrackAccess(path: string): Promise<void> {
  return invoke("fff_track_access", { path });
}
