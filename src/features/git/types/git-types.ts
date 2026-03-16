export interface GitFile {
  path: string;
  status: "modified" | "added" | "deleted" | "untracked" | "renamed";
  staged: boolean;
}

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  files: GitFile[];
}

export interface GitCommit {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export interface GitDiffLine {
  line_type: "added" | "removed" | "context" | "header";
  content: string;
  old_line_number?: number;
  new_line_number?: number;
}

export interface GitDiff {
  file_path: string;
  old_path?: string;
  new_path?: string;
  is_new: boolean;
  is_deleted: boolean;
  is_renamed: boolean;
  lines: GitDiffLine[];
  is_binary?: boolean;
  is_image?: boolean;
  old_blob_base64?: string;
  new_blob_base64?: string;
}

export interface GitHunk {
  file_path: string;
  lines: GitDiffLine[];
}

export interface GitRemote {
  name: string;
  url: string;
}

export interface GitStash {
  index: number;
  message: string;
  date: string;
}

export interface GitTag {
  name: string;
  commit: string;
  message?: string;
  date: string;
}

export interface GitBlame {
  file_path: string;
  lines: GitBlameLine[];
}

export interface GitBlameLine {
  line_number: number;
  total_lines: number;
  commit_hash: string;
  author: string;
  email: string;
  time: number;
  commit: string;
}
