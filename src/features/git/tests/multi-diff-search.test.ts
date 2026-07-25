import { describe, expect, test } from "vite-plus/test";
import type { MultiFileDiff } from "../types/git-diff.types";
import { findMultiDiffMatches } from "../utils/multi-diff-search";

const multiDiff: MultiFileDiff = {
  commitHash: "working-tree",
  totalFiles: 2,
  totalAdditions: 2,
  totalDeletions: 0,
  fileKeys: ["first", "second"],
  files: [
    {
      file_path: "src/first.ts",
      is_new: false,
      is_deleted: false,
      is_renamed: false,
      lines: [
        { line_type: "header", content: "@@ -1 +1 @@" },
        { line_type: "added", content: "const Project = project;", new_line_number: 1 },
      ],
    },
    {
      file_path: "src/second.ts",
      is_new: false,
      is_deleted: false,
      is_renamed: false,
      lines: [
        { line_type: "added", content: "project.project()", new_line_number: 1 },
        { line_type: "context", content: "projection", new_line_number: 2 },
      ],
    },
  ],
};

describe("multi-diff search", () => {
  test("maps matches to their file section and diff line", () => {
    const matches = findMultiDiffMatches(multiDiff, "project", {
      caseSensitive: false,
      wholeWord: false,
      useRegex: false,
    });

    expect(matches).toEqual([
      { sectionKey: "first", fileIndex: 0, lineIndex: 1, start: 6, end: 13 },
      { sectionKey: "first", fileIndex: 0, lineIndex: 1, start: 16, end: 23 },
      { sectionKey: "second", fileIndex: 1, lineIndex: 0, start: 0, end: 7 },
      { sectionKey: "second", fileIndex: 1, lineIndex: 0, start: 8, end: 15 },
      { sectionKey: "second", fileIndex: 1, lineIndex: 1, start: 0, end: 7 },
    ]);
  });

  test("supports whole-word, case-sensitive, and regular-expression searches", () => {
    expect(
      findMultiDiffMatches(multiDiff, "project", {
        caseSensitive: true,
        wholeWord: true,
        useRegex: false,
      }),
    ).toHaveLength(3);

    expect(
      findMultiDiffMatches(multiDiff, "Project", {
        caseSensitive: true,
        wholeWord: true,
        useRegex: false,
      }),
    ).toHaveLength(1);

    expect(
      findMultiDiffMatches(multiDiff, "pro.*?tion", {
        caseSensitive: false,
        wholeWord: false,
        useRegex: true,
      }),
    ).toHaveLength(1);
  });

  test("does not search diff hunk headers or invalid expressions", () => {
    expect(
      findMultiDiffMatches(multiDiff, "@@", {
        caseSensitive: false,
        wholeWord: false,
        useRegex: false,
      }),
    ).toEqual([]);

    expect(
      findMultiDiffMatches(multiDiff, "[", {
        caseSensitive: false,
        wholeWord: false,
        useRegex: true,
      }),
    ).toEqual([]);
  });
});
