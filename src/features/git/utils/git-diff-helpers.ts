import type { DiffLineWithIndex, ParsedHunk } from "../types/git-diff.types";
import type { GitDiff, GitDiffLine, GitHunk } from "../types/git.types";
import { writeClipboardText } from "@/utils/clipboard";
export {
  getDiffLineVisualState,
  getDiffLineVisualType,
  type DiffLineVisualState,
  type DiffLineVisualType,
} from "./diff-viewer-visuals";

export interface DiffHunkRange {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  context: string;
}

export function parseDiffHunkRange(content: string): DiffHunkRange | null {
  const match = content.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)/);
  if (!match) return null;

  return {
    oldStart: Number(match[1]),
    oldCount: Number(match[2] || "1"),
    newStart: Number(match[3]),
    newCount: Number(match[4] || "1"),
    context: match[5]?.trim() || "",
  };
}

export function getSkippedUnchangedLineCount(
  previousHunk: ParsedHunk | undefined,
  currentHunk: ParsedHunk,
): number | null {
  const currentRange = parseDiffHunkRange(currentHunk.header.content);
  if (!currentRange) return null;

  if (!previousHunk) {
    const skippedBeforeFirstHunk = Math.min(
      Math.max(currentRange.oldStart - 1, 0),
      Math.max(currentRange.newStart - 1, 0),
    );

    return skippedBeforeFirstHunk > 0 ? skippedBeforeFirstHunk : null;
  }

  const previousRange = parseDiffHunkRange(previousHunk.header.content);
  if (!previousRange) return null;

  const previousOldEnd = previousRange.oldStart + previousRange.oldCount - 1;
  const previousNewEnd = previousRange.newStart + previousRange.newCount - 1;
  const skippedLines = Math.min(
    currentRange.oldStart - previousOldEnd - 1,
    currentRange.newStart - previousNewEnd - 1,
  );

  return skippedLines > 0 ? skippedLines : null;
}

export const createGitHunk = (
  hunk: { header: GitDiffLine; lines: GitDiffLine[] },
  filePath: string,
): GitHunk => ({
  file_path: filePath,
  lines: [hunk.header, ...hunk.lines],
});

export const getImgSrc = (base64: string | undefined) =>
  base64 ? `data:image/*;base64,${base64}` : undefined;

export function getFileStatus(diff: GitDiff): string {
  if (diff.is_new) return "added";
  if (diff.is_deleted) return "deleted";
  if (diff.is_renamed) return "renamed";
  return "modified";
}

export function groupLinesIntoHunks(lines: GitDiffLine[]): ParsedHunk[] {
  const hunks: ParsedHunk[] = [];
  let currentHunk: DiffLineWithIndex[] = [];
  let hunkHeader: GitDiffLine | null = null;
  let hunkId = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.line_type === "header") {
      if (hunkHeader && currentHunk.length > 0) {
        hunks.push({
          header: hunkHeader,
          lines: currentHunk,
          id: hunkId++,
        });
      }
      hunkHeader = line;
      currentHunk = [];
    } else {
      currentHunk.push({ ...line, diffIndex: i });
    }
  }

  if (hunkHeader && currentHunk.length > 0) {
    hunks.push({
      header: hunkHeader,
      lines: currentHunk,
      id: hunkId,
    });
  }

  return hunks;
}

export function countDiffStats(diffs: GitDiff[]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const diff of diffs) {
    if (typeof diff.additions === "number" || typeof diff.deletions === "number") {
      additions += diff.additions ?? 0;
      deletions += diff.deletions ?? 0;
      continue;
    }

    for (const line of diff.lines) {
      if (line.line_type === "added") additions++;
      else if (line.line_type === "removed") deletions++;
    }
  }
  return { additions, deletions };
}

export function copyLineContent(content: string) {
  void writeClipboardText(content);
}
