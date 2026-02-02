import type { DiffLineWithIndex, ParsedHunk } from "../types/diff";
import type { GitDiff, GitDiffLine, GitHunk } from "../types/git";

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
    for (const line of diff.lines) {
      if (line.line_type === "added") additions++;
      else if (line.line_type === "removed") deletions++;
    }
  }
  return { additions, deletions };
}

export function copyLineContent(content: string) {
  navigator.clipboard.writeText(content);
}
