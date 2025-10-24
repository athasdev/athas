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
