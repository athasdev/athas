import type { FileEntry } from "@/features/file-system/types/app";

export interface SearchResult {
  file: string;
  line: number;
  column: number;
  text: string;
  match: string;
}

export interface SearchViewProps {
  rootFolderPath?: string;
  allProjectFiles: FileEntry[];
  onFileSelect: (path: string, line?: number, column?: number) => void;
  onFileOpen?: (path: string, line?: number, column?: number) => void;
}
