export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  children?: FileEntry[];
  expanded?: boolean;
  isEditing?: boolean;
  isNewItem?: boolean;
  ignored?: boolean;
}

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
