export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  children?: FileEntry[];
  expanded?: boolean;
}

export type VimMode = "normal" | "insert" | "visual";

export interface ContextMenuState {
  x: number;
  y: number;
  path: string;
  isDir: boolean;
}

export interface SearchState {
  query: string;
  currentMatch: number;
  totalMatches: number;
  matches: { start: number; end: number }[];
}
