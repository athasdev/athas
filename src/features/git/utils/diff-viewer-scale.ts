import type { MultiFileDiff } from "../types/git-diff-types";
import type { GitDiff } from "../types/git-types";

export const LARGE_DIFF_EDITOR_LINE_THRESHOLD = 20_000;

const diffFileKey = (multiDiff: MultiFileDiff, diff: GitDiff, index: number): string =>
  multiDiff.fileKeys?.[index] ?? `${diff.file_path}:${index}`;

export function getInitialExpandedDiffFileKeys(multiDiff: MultiFileDiff): string[] {
  if (multiDiff.initiallyExpandedFileKey) {
    return [multiDiff.initiallyExpandedFileKey];
  }

  const firstDiff = multiDiff.files[0];
  if (!firstDiff) return [];

  return [diffFileKey(multiDiff, firstDiff, 0)];
}

export function shouldUseScrollableDiffEditor(diff: GitDiff): boolean {
  return Boolean(diff.raw_patch) || diff.lines.length > LARGE_DIFF_EDITOR_LINE_THRESHOLD;
}
