import { describe, expect, test } from "vite-plus/test";
import type { MultiFileDiff } from "../types/git-diff.types";
import type { GitDiff } from "../types/git.types";
import {
  LARGE_DIFF_EDITOR_LINE_THRESHOLD,
  getInitialExpandedDiffFileKeys,
  shouldUseScrollableDiffEditor,
} from "../utils/diff-viewer-scale";

const createDiff = (filePath: string, lineCount: number): GitDiff => ({
  file_path: filePath,
  is_new: false,
  is_deleted: false,
  is_renamed: false,
  lines: Array.from({ length: lineCount }, (_, index) => ({
    line_type: "context",
    content: `line ${index + 1}`,
    old_line_number: index + 1,
    new_line_number: index + 1,
  })),
});

const createMultiDiff = (files: GitDiff[]): MultiFileDiff => ({
  commitHash: "abc123",
  files,
  totalFiles: files.length,
  totalAdditions: 0,
  totalDeletions: 0,
});

describe("diff viewer scale helpers", () => {
  test("expands every file by default", () => {
    const multiDiff = createMultiDiff([createDiff("src/a.ts", 1), createDiff("src/b.ts", 1)]);

    expect(getInitialExpandedDiffFileKeys(multiDiff)).toEqual(["src/a.ts:0", "src/b.ts:1"]);
  });

  test("expands every file when one is requested initially", () => {
    const multiDiff = {
      ...createMultiDiff([createDiff("src/a.ts", 1), createDiff("src/b.ts", 1)]),
      fileKeys: ["first", "second"],
      initiallyExpandedFileKey: "second",
    };

    expect(getInitialExpandedDiffFileKeys(multiDiff)).toEqual(["first", "second"]);
  });

  test("uses a scrollable editor for very large file diffs", () => {
    expect(shouldUseScrollableDiffEditor(createDiff("src/small.ts", 10))).toBe(false);
    expect(
      shouldUseScrollableDiffEditor(
        createDiff("src/large.ts", LARGE_DIFF_EDITOR_LINE_THRESHOLD + 1),
      ),
    ).toBe(true);
  });

  test("uses a scrollable editor for raw patch diffs", () => {
    expect(
      shouldUseScrollableDiffEditor({
        ...createDiff("src/raw.ts", 0),
        raw_patch: "diff --git a/src/raw.ts b/src/raw.ts\n+new\n",
      }),
    ).toBe(true);
  });
});
