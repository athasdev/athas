import { invoke } from "@tauri-apps/api/core";

export interface SearchMatch {
  line_number: number;
  line_content: string;
  column_start: number;
  column_end: number;
}

export interface FileSearchResult {
  file_path: string;
  matches: SearchMatch[];
  total_matches: number;
}

export interface SearchFilesRequest {
  root_path: string;
  query: string;
  case_sensitive?: boolean;
  max_results?: number;
}

export async function searchFilesContent(request: SearchFilesRequest): Promise<FileSearchResult[]> {
  return invoke<FileSearchResult[]>("search_files_content", { request });
}

export interface FffSearchHit {
  path: string;
  name: string;
  relative_path: string;
  score: number;
}

export async function fffSetWorkspace(basePath: string): Promise<void> {
  return invoke("fff_set_workspace", { basePath });
}

export async function fffSearchFiles(query: string, limit = 100): Promise<FffSearchHit[]> {
  return invoke<FffSearchHit[]>("fff_search_files", { query, limit });
}

export async function fffTrackAccess(path: string): Promise<void> {
  return invoke("fff_track_access", { path });
}
