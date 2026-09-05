import { describe, expect, test } from "vite-plus/test";
import { getDiffBufferFilePath } from "../utils/diff-buffer-path";
import { hasGitDiffChanges } from "../utils/git-diff-helpers";

describe("diff refresh content", () => {
  const empty = {
    file_path: "file",
    lines: [],
    is_new: false,
    is_deleted: false,
    is_renamed: false,
  };
  test.each(["is_image", "is_binary", "is_new", "is_deleted", "is_renamed"])(
    "keeps %s changes open even without text hunks",
    (flag) => {
      expect(hasGitDiffChanges({ ...empty, [flag]: true })).toBe(true);
    },
  );
  test("recognizes an unchanged file", () => {
    expect(hasGitDiffChanges(empty)).toBe(false);
    expect(hasGitDiffChanges(null)).toBe(false);
  });
});

describe("getDiffBufferFilePath", () => {
  test("resolves virtual working-tree diff paths", () => {
    expect(getDiffBufferFilePath("diff://unstaged/src%2Fapp.ts")).toBe("src/app.ts");
  });

  test("uses real diff buffer paths for opened .patch files", () => {
    expect(getDiffBufferFilePath("/repo/fix.patch")).toBe("/repo/fix.patch");
  });

  test("keeps aggregate virtual diff buffers without a single file path", () => {
    expect(getDiffBufferFilePath("diff://commit/abc123/all-files")).toBeNull();
  });
});
