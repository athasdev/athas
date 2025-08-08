import type { GitDiff, GitDiffLine, GitHunk } from "@/utils/git";
import type { ParsedHunk } from "./types";

export const createGitHunk = (
  hunk: { header: GitDiffLine; lines: GitDiffLine[] },
  filePath: string,
): GitHunk => ({
  file_path: filePath,
  lines: [hunk.header, ...hunk.lines],
});

export const getImgSrc = (base64: string | undefined) =>
  base64 ? `data:image/*;base64,${base64}` : undefined;

/**
 * Get human-readable file status from diff object
 * @param diff The diff object
 * @returns Human-readable status string
 */
export function getFileStatus(diff: GitDiff): string {
  if (diff.is_new) return "added";
  if (diff.is_deleted) return "deleted";
  if (diff.is_renamed) return "renamed";
  return "modified";
}

export function groupLinesIntoHunks(lines: GitDiffLine[]): ParsedHunk[] {
  const hunks: ParsedHunk[] = [];
  let currentHunk: GitDiffLine[] = [];
  let hunkHeader: GitDiffLine | null = null;
  let hunkId = 0;

  for (const line of lines) {
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
      currentHunk.push(line);
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

export function copyLineContent(content: string) {
  navigator.clipboard.writeText(content);
}
