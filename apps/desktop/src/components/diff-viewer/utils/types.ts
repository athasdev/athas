import type { GitDiff, GitDiffLine, GitHunk } from "../../../utils/git";

export interface DiffViewerProps {
  onStageHunk?: (hunk: GitHunk) => void;
  onUnstageHunk?: (hunk: GitHunk) => void;
}

export interface ParsedHunk {
  header: GitDiffLine;
  lines: GitDiffLine[];
  id: number;
}

export interface ImageContainerProps {
  label: string;
  labelColor: string;
  base64?: string;
  alt: string;
  zoom: number;
}

export interface DiffHeaderProps {
  fileName: string;
  diff: GitDiff;
  viewMode: "unified" | "split";
  showWhitespace: boolean;
  onViewModeChange: (mode: "unified" | "split") => void;
  onShowWhitespaceChange: (show: boolean) => void;
  onClose: () => void;
}

export interface DiffHunkHeaderProps {
  hunk: ParsedHunk;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isStaged: boolean;
  filePath: string;
  onStageHunk?: (hunk: GitHunk) => void;
  onUnstageHunk?: (hunk: GitHunk) => void;
}

export interface DiffLineProps {
  line: GitDiffLine;
  index: number;
  hunkId: number;
  viewMode: "unified" | "split";
  showWhitespace: boolean;
}

export interface TextDiffViewerProps {
  diff: GitDiff;
  isStaged: boolean;
  viewMode: "unified" | "split";
  showWhitespace: boolean;
  onStageHunk?: (hunk: GitHunk) => void;
  onUnstageHunk?: (hunk: GitHunk) => void;
}

export interface ImageDiffViewerProps {
  diff: GitDiff;
  fileName: string;
  onClose: () => void;
}

// New types for multi-file diff support
export interface MultiFileDiff {
  commitHash: string;
  files: GitDiff[];
  totalFiles: number;
  totalAdditions: number;
  totalDeletions: number;
}

export interface MultiFileDiffViewerProps {
  multiDiff: MultiFileDiff;
  onClose: () => void;
}

export interface FileDiffSummary {
  fileName: string;
  filePath: string;
  status: "added" | "deleted" | "modified" | "renamed";
  additions: number;
  deletions: number;
  isCollapsed: boolean;
  shouldAutoCollapse: boolean;
}
