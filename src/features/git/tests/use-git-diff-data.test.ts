import { describe, expect, test } from "vite-plus/test";
import { getDiffBufferFilePath } from "../utils/diff-buffer-path";

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
