import { Channel } from "@tauri-apps/api/core";
import {
  commands,
  type ContentSearchEvent,
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
  unreadable_files?: number;
  first_read_error?: string | null;
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

export interface SearchFilesStreamHandlers {
  /** The index is still being built; the backend starts searching once it is ready. */
  onIndexing?: (indexedFiles: number) => void;
  /** Matches found since the previous batch, as they arrive. */
  onResults?: (results: FileSearchResult[]) => void;
  /** Stops the search in the backend when it returns true; checked as batches arrive. */
  isCancelled?: () => boolean;
}

let nextSearchStreamId = 0;

/**
 * Searches file contents and resolves with one page. Matches stream in over a channel as the
 * index is read, so callers can show them before the page is complete, and indexing progress
 * arrives on the same channel instead of through polling.
 */
export function searchFilesContent(
  request: SearchFilesRequest,
  handlers: SearchFilesStreamHandlers = {},
): Promise<SearchFilesResponse> {
  const searchId = `content-search-${++nextSearchStreamId}`;
  const results: FileSearchResult[] = [];

  return new Promise<SearchFilesResponse>((resolve, reject) => {
    let cancelled = false;
    const cancel = () => {
      if (cancelled) return;
      cancelled = true;
      void commands.cancelIpcStream(searchId).catch(() => {});
    };

    const channel = new Channel<ContentSearchEvent>((event) => {
      if (handlers.isCancelled?.()) cancel();
      switch (event.kind) {
        case "indexing":
          handlers.onIndexing?.(event.indexed_files);
          break;
        case "results":
          results.push(...event.results);
          handlers.onResults?.(event.results);
          break;
        case "done":
          resolve({
            results,
            total_files: event.summary.total_files,
            searched_files: event.summary.searched_files,
            searchable_files: event.summary.searchable_files,
            files_with_matches: results.length,
            next_file_offset: event.summary.next_file_offset,
            has_more: event.summary.has_more,
            is_indexing: false,
            indexed_files: event.summary.indexed_files,
            regex_fallback_error: event.summary.regex_fallback_error,
          });
          break;
      }
    });

    commands
      .searchFilesContentStream(
        {
          search_id: searchId,
          root_paths: request.root_paths,
          query: request.query,
          case_sensitive: request.case_sensitive ?? null,
          whole_word: request.whole_word ?? null,
          use_regex: request.use_regex ?? null,
          max_results: request.max_results ?? null,
          file_offset: request.file_offset ?? null,
          context_lines: request.context_lines ?? null,
        },
        channel,
      )
      .catch(reject);
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
