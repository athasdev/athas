import type { MultiFileDiff } from "../types/git-diff.types";
import type { GitDiff } from "../types/git.types";
import { getMultiDiffSectionKey } from "./multi-diff-search";

export interface MultiDiffSelection {
  diff: GitDiff;
  index: number;
  key: string;
  path: string;
}

export function getMultiDiffFilePath(diff: GitDiff): string {
  return diff.new_path || diff.old_path || diff.file_path;
}

export function resolveMultiDiffSelection(multiDiff: MultiFileDiff): MultiDiffSelection | null {
  const preferredKey = multiDiff.selectedFileKey ?? multiDiff.initiallyExpandedFileKey;
  let index = preferredKey
    ? multiDiff.files.findIndex(
        (diff, fileIndex) => getMultiDiffSectionKey(multiDiff, diff, fileIndex) === preferredKey,
      )
    : -1;

  if (index < 0 && multiDiff.selectedFilePath) {
    index = multiDiff.files.findIndex(
      (diff) => getMultiDiffFilePath(diff) === multiDiff.selectedFilePath,
    );
  }
  if (index < 0 && multiDiff.files.length > 0) index = 0;

  const diff = multiDiff.files[index];
  if (!diff) return null;

  return {
    diff,
    index,
    key: getMultiDiffSectionKey(multiDiff, diff, index),
    path: getMultiDiffFilePath(diff),
  };
}

export function selectMultiDiffFile(multiDiff: MultiFileDiff, key: string): MultiFileDiff {
  const index = multiDiff.files.findIndex(
    (diff, fileIndex) => getMultiDiffSectionKey(multiDiff, diff, fileIndex) === key,
  );
  const diff = multiDiff.files[index];
  if (!diff) return multiDiff;

  const path = getMultiDiffFilePath(diff);
  if (multiDiff.selectedFileKey === key && multiDiff.selectedFilePath === path) return multiDiff;

  return { ...multiDiff, selectedFileKey: key, selectedFilePath: path };
}

export function selectMultiDiffFileByPath(
  multiDiff: MultiFileDiff,
  filePath: string,
): MultiFileDiff {
  const index = multiDiff.files.findIndex(
    (diff) =>
      diff.file_path === filePath || diff.new_path === filePath || diff.old_path === filePath,
  );
  const diff = multiDiff.files[index];
  if (!diff) return multiDiff;

  return selectMultiDiffFile(multiDiff, getMultiDiffSectionKey(multiDiff, diff, index));
}
