import { describe, expect, test } from "vite-plus/test";
import type { MultiFileDiff } from "../types/git-diff.types";
import type { GitDiff } from "../types/git.types";
import { isDiffFile, parseRawDiffContent } from "../utils/git-diff-parser";
import { getDiffLineVisualState } from "../utils/git-diff-helpers";

function isMultiFileDiff(value: GitDiff | MultiFileDiff): value is MultiFileDiff {
  return "files" in value;
}

describe("git diff parser", () => {
  test("recognizes .patch files as diff files", () => {
    expect(isDiffFile("/tmp/fix.patch")).toBe(true);
  });

  test("does not treat plain text adblock exception rules as diff files", () => {
    expect(
      isDiffFile(
        "/tmp/easylist.txt",
        ["[Adblock Plus 2.0]", "!", "@@||example.com^$document", "||ads.example.com^"].join("\n"),
      ),
    ).toBe(false);
  });

  test("recognizes pasted git patches without relying on the extension", () => {
    expect(
      isDiffFile(
        "/tmp/change.txt",
        [
          "diff --git a/src/app.ts b/src/app.ts",
          "index 1111111..2222222 100644",
          "--- a/src/app.ts",
          "+++ b/src/app.ts",
          "@@ -1 +1 @@",
          "-old",
          "+new",
        ].join("\n"),
      ),
    ).toBe(true);
  });

  test("parses a single-file git patch using the patched file path", () => {
    const result = parseRawDiffContent(
      [
        "diff --git a/src/app.ts b/src/app.ts",
        "index 1111111..2222222 100644",
        "--- a/src/app.ts",
        "+++ b/src/app.ts",
        "@@ -1,2 +1,2 @@",
        " const keep = true;",
        "-const oldValue = 1;",
        "+const newValue = 1;",
        "+--- literal content",
      ].join("\n"),
      "/repo/change.patch",
    );

    expect(isMultiFileDiff(result)).toBe(false);
    expect((result as GitDiff).file_path).toBe("src/app.ts");
    expect((result as GitDiff).lines.map((line) => line.line_type)).toEqual([
      "header",
      "context",
      "removed",
      "added",
      "added",
    ]);
    const parsedLines = (result as GitDiff).lines;
    expect(parsedLines[parsedLines.length - 1]?.content).toBe("--- literal content");
  });

  test("parses multi-file git patch files as multi-file diffs", () => {
    const result = parseRawDiffContent(
      [
        "From 123 Mon Sep 17 00:00:00 2001",
        "Subject: [PATCH] Update files",
        "",
        "diff --git a/src/first.ts b/src/first.ts",
        "index 1111111..2222222 100644",
        "--- a/src/first.ts",
        "+++ b/src/first.ts",
        "@@ -1 +1 @@",
        "-old",
        "+new",
        "diff --git a/src/second.ts b/src/second.ts",
        "index 3333333..4444444 100644",
        "--- a/src/second.ts",
        "+++ b/src/second.ts",
        "@@ -2 +2 @@",
        "-before",
        "+after",
      ].join("\n"),
      "/repo/changes.patch",
    );

    expect(isMultiFileDiff(result)).toBe(true);
    const multiDiff = result as MultiFileDiff;
    expect(multiDiff.files.map((file) => file.file_path)).toEqual([
      "src/first.ts",
      "src/second.ts",
    ]);
    expect(multiDiff.totalFiles).toBe(2);
    expect(multiDiff.totalAdditions).toBe(2);
    expect(multiDiff.totalDeletions).toBe(2);
  });

  test("maps diff line types to shared visual state", () => {
    expect(getDiffLineVisualState("added")).toEqual({
      lineBackground: "bg-git-added/15",
      gutterBackground: "bg-git-added/25",
      contentColor: "text-git-added",
    });
    expect(getDiffLineVisualState("removed")).toEqual({
      lineBackground: "bg-git-deleted/15",
      gutterBackground: "bg-git-deleted/25",
      contentColor: "text-git-deleted",
    });
    expect(getDiffLineVisualState("header")).toEqual({
      lineBackground: "",
      gutterBackground: "bg-primary-bg",
      contentColor: "text-text",
    });
  });
});
