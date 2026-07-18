import type { MultiFileDiff } from "../types/git-diff.types";
import type { GitDiff } from "../types/git.types";

export const LARGE_DIFF_EDITOR_LINE_THRESHOLD = 20_000;
export const DIFF_INLINE_RENDER_LINE_THRESHOLD = 1_200;
export const DIFF_HIGHLIGHT_LINE_THRESHOLD = 2_000;
export const DIFF_SERIALIZED_LINE_LIMIT = 20_000;

const diffFileKey = (multiDiff: MultiFileDiff, diff: GitDiff, index: number): string =>
  multiDiff.fileKeys?.[index] ?? `${diff.file_path}:${index}`;

export function getInitialExpandedDiffFileKeys(multiDiff: MultiFileDiff): string[] {
  if (multiDiff.initiallyExpandedFileKey) {
    return [multiDiff.initiallyExpandedFileKey];
  }

  if (multiDiff.files[0]) {
    return [diffFileKey(multiDiff, multiDiff.files[0], 0)];
  }

  return [];
}

export function shouldUseScrollableDiffEditor(diff: GitDiff): boolean {
  return Boolean(diff.raw_patch) || diff.lines.length > LARGE_DIFF_EDITOR_LINE_THRESHOLD;
}
