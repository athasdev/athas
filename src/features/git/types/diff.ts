import type { HighlightToken } from "@/features/editor/lib/wasm-parser/types";
import type { GitDiff, GitDiffLine, GitHunk } from "./git";

export interface DiffViewerProps {
  onStageHunk?: (hunk: GitHunk) => void;
  onUnstageHunk?: (hunk: GitHunk) => void;
}

export interface DiffLineWithIndex extends GitDiffLine {
  diffIndex: number;
}

export interface ParsedHunk {
  header: GitDiffLine;
  lines: DiffLineWithIndex[];
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
  fileName?: string;
  diff?: GitDiff;
  viewMode?: "unified" | "split";
  onViewModeChange?: (mode: "unified" | "split") => void;

  commitHash?: string;
  totalFiles?: number;
  onExpandAll?: () => void;
  onCollapseAll?: () => void;

  showWhitespace: boolean;
  onShowWhitespaceChange: (show: boolean) => void;
  onClose?: () => void;
}

export interface DiffHunkHeaderProps {
  hunk: ParsedHunk;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isStaged: boolean;
  filePath: string;
  onStageHunk?: (hunk: GitHunk) => void;
  onUnstageHunk?: (hunk: GitHunk) => void;
  isInMultiFileView?: boolean;
}

export interface DiffLineProps {
  line: GitDiffLine;
  viewMode: "unified" | "split";
  showWhitespace: boolean;
  fontSize: number;
  lineHeight: number;
  tabSize: number;
  tokens?: HighlightToken[];
}

export interface TextDiffViewerProps {
  diff: GitDiff;
  isStaged: boolean;
  viewMode: "unified" | "split";
  showWhitespace: boolean;
  onStageHunk?: (hunk: GitHunk) => void;
  onUnstageHunk?: (hunk: GitHunk) => void;
  isInMultiFileView?: boolean;
}

export interface ImageDiffViewerProps {
  diff: GitDiff;
  fileName: string;
  onClose: () => void;
  commitHash?: string;
}

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
  shouldAutoCollapse: boolean;
}
