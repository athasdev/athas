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
  description?: string | null;
  author: string;
  email?: string;
  date: string;
}

export interface GitDiffLine {
  line_type: "added" | "removed" | "context" | "header";
  content: string;
  old_line_number?: number | null;
  new_line_number?: number | null;
}

export interface GitDiff {
  file_path: string;
  old_path?: string | null;
  new_path?: string | null;
  is_new: boolean;
  is_deleted: boolean;
  is_renamed: boolean;
  lines: GitDiffLine[];
  is_binary?: boolean;
  is_image?: boolean;
  old_blob_base64?: string | null;
  new_blob_base64?: string | null;
  raw_patch?: string | null;
  additions?: number | null;
  deletions?: number | null;
  is_truncated?: boolean | null;
}

export interface GitDiffStat {
  file_path: string;
  staged: boolean;
  additions: number;
  deletions: number;
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
  message?: string | null;
  date: string;
  is_annotated: boolean;
}

export interface GitWorktree {
  path: string;
  branch?: string | null;
  head: string;
  is_bare: boolean;
  is_detached: boolean;
  locked_reason?: string | null;
  prunable_reason?: string | null;
  is_current: boolean;
}

export interface GitBlame {
  file_path: string;
  lines: GitBlameLine[];
}

export interface GitBlameLine {
  line_number: number;
  total_lines: number;
  commit_hash: string;
  is_uncommitted: boolean;
  author: string;
  email: string;
  time: number;
  commit: string;
}
