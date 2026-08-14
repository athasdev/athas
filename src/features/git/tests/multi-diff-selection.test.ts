import { describe, expect, it } from "vite-plus/test";
import type { MultiFileDiff } from "../types/git-diff.types";
import type { GitDiff } from "../types/git.types";
import {
  resolveMultiDiffSelection,
  selectMultiDiffFile,
  selectMultiDiffFileByPath,
} from "../utils/multi-diff-selection";

const createDiff = (filePath: string, newPath?: string): GitDiff => ({
  file_path: filePath,
  new_path: newPath,
  is_new: false,
  is_deleted: false,
  is_renamed: Boolean(newPath),
  lines: [],
});

const createMultiDiff = (): MultiFileDiff => ({
  commitHash: "abc1234",
  files: [createDiff("src/first.ts"), createDiff("src/old.ts", "src/renamed.ts")],
  fileKeys: ["first", "second"],
  totalFiles: 2,
  totalAdditions: 0,
  totalDeletions: 0,
});

describe("multi diff selection", () => {
  it("falls back to the first file when no selection is stored", () => {
    expect(resolveMultiDiffSelection(createMultiDiff())).toMatchObject({
      key: "first",
      path: "src/first.ts",
      index: 0,
    });
  });

  it("stores a stable key and displayed path together", () => {
    const selected = selectMultiDiffFile(createMultiDiff(), "second");

    expect(selected).toMatchObject({
      selectedFileKey: "second",
      selectedFilePath: "src/renamed.ts",
    });
    expect(resolveMultiDiffSelection(selected)).toMatchObject({
      key: "second",
      path: "src/renamed.ts",
      index: 1,
    });
  });

  it("selects renamed files by either their old or new path", () => {
    expect(selectMultiDiffFileByPath(createMultiDiff(), "src/old.ts")).toMatchObject({
      selectedFileKey: "second",
      selectedFilePath: "src/renamed.ts",
    });
  });

  it("preserves the same object when a requested key is missing", () => {
    const multiDiff = createMultiDiff();
    expect(selectMultiDiffFile(multiDiff, "missing")).toBe(multiDiff);
  });
});
