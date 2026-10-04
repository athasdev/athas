import {
  commands,
  type FffIndexedFile,
  type FffScanStatus,
  type FffSearchHit,
} from "@/bindings/commands";

export type { FffIndexedFile, FffScanStatus, FffSearchHit };

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

export async function searchFilesContent(
  request: SearchFilesRequest,
): Promise<SearchFilesResponse> {
  return commands.searchFilesContent({
    root_paths: request.root_paths,
    query: request.query,
    case_sensitive: request.case_sensitive ?? null,
    whole_word: request.whole_word ?? null,
    use_regex: request.use_regex ?? null,
    max_results: request.max_results ?? null,
    file_offset: request.file_offset ?? null,
    context_lines: request.context_lines ?? null,
  });
}

export async function fffEnsureWorkspaces(rootPaths: readonly string[]): Promise<void> {
  await commands.fffEnsureWorkspaces([...rootPaths]);
}

export async function fffScanStatus(rootPaths: readonly string[]): Promise<FffScanStatus> {
  return commands.fffScanStatus([...rootPaths]);
}

export async function fffSearchFiles(
  query: string,
  rootPaths: readonly string[],
  limit = 100,
): Promise<FffSearchHit[]> {
  return commands.fffSearchFiles(query, limit, [...rootPaths]);
}

export async function fffListFiles(rootPaths: readonly string[]): Promise<FffIndexedFile[]> {
  return commands.fffListFiles([...rootPaths]);
}

export async function fffTrackAccess(path: string): Promise<void> {
  await commands.fffTrackAccess(path);
}
