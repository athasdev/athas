export interface FileItem {
  name: string;
  path: string;
  isDir: boolean;
}

export interface CategorizedFiles {
  openBufferFiles: FileItem[];
  recentFilesInResults: FileItem[];
  otherFiles: FileItem[];
}

export type FileCategory = "open" | "recent" | "other";

export interface ScoredFile {
  file: FileItem;
  score: number;
}
