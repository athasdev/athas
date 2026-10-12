import { describe, expect, it } from "vite-plus/test";
import { formatDiffBufferLabel } from "../services/diff-buffer-label";
import {
  getDiffEditorPath,
  parseDiffAccordionLine,
  serializeGitDiffForEditor,
  serializeGitDiffSourceForEditor,
  serializeGitDiffSourceForSplitEditor,
  serializeMultiFileDiffForEditor,
} from "../services/diff-editor-content";
import type { MultiFileDiff } from "../types/git-diff.types";
import type { GitDiff, GitDiffLine } from "../types/git.types";
import { DIFF_SERIALIZED_LINE_LIMIT } from "../utils/diff-viewer-scale";

function makeDiff(overrides: Partial<GitDiff> = {}): GitDiff {
  return {
    file_path: "src/app.ts",
    old_path: "src/app.ts",
    new_path: "src/app.ts",
    is_new: false,
    is_deleted: false,
    is_renamed: false,
    lines: [
      { line_type: "header", content: "@@ -1,2 +1,2 @@" },
      { line_type: "context", content: "keep", old_line_number: 1, new_line_number: 1 },
      { line_type: "removed", content: "old", old_line_number: 2 },
      { line_type: "added", content: "new", new_line_number: 2 },
    ],
    ...overrides,
  } as GitDiff;
}

describe("serializeGitDiffForEditor", () => {
  it("adds a git patch header and diff markers", () => {
    expect(serializeGitDiffForEditor(makeDiff()).split("\n")).toEqual([
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1,2 +1,2 @@",
      " keep",
      "-old",
      "+new",
    ]);
  });

  it("uses /dev/null for created and deleted files", () => {
    const created = serializeGitDiffForEditor(
      makeDiff({ is_new: true, old_path: undefined, lines: [] }),
    );
    const deleted = serializeGitDiffForEditor(
      makeDiff({ is_deleted: true, new_path: undefined, lines: [] }),
    );

    expect(created).toContain("--- /dev/null");
    expect(created).toContain("+++ b/src/app.ts");
    expect(deleted).toContain("--- a/src/app.ts");
    expect(deleted).toContain("+++ /dev/null");
  });

  it("keeps an existing patch header instead of adding another", () => {
    const serialized = serializeGitDiffForEditor(
      makeDiff({
        lines: [
          { line_type: "header", content: "diff --git a/x b/x" },
          { line_type: "added", content: "y" },
        ] as GitDiffLine[],
      }),
    );

    expect(serialized).toBe("diff --git a/x b/x\n+y");
  });

  it("returns a raw patch unchanged when it is small", () => {
    expect(serializeGitDiffForEditor(makeDiff({ raw_patch: "raw\npatch" }))).toBe("raw\npatch");
  });

  it("truncates huge raw patches and huge line lists with a note", () => {
    const rawPatch = Array.from({ length: DIFF_SERIALIZED_LINE_LIMIT + 5 }, (_, i) => `l${i}`).join(
      "\n",
    );
    const truncatedRaw = serializeGitDiffForEditor(makeDiff({ raw_patch: rawPatch })).split("\n");
    expect(truncatedRaw).toHaveLength(DIFF_SERIALIZED_LINE_LIMIT + 1);
    expect(truncatedRaw.slice(-1)[0]).toMatch(/^# Athas truncated this diff after/);

    const lines = Array.from({ length: DIFF_SERIALIZED_LINE_LIMIT + 1 }, () => ({
      line_type: "context" as const,
      content: "x",
    }));
    const truncated = serializeGitDiffForEditor(makeDiff({ lines })).split("\n");
    expect(truncated).toHaveLength(3 + DIFF_SERIALIZED_LINE_LIMIT + 1);
    expect(truncated.slice(-1)[0]).toMatch(/^# Athas truncated/);
  });
});

describe("serializeGitDiffSourceForEditor", () => {
  it("keeps source text with line kinds, real line numbers and spacers between hunks", () => {
    const result = serializeGitDiffSourceForEditor(
      makeDiff({
        lines: [
          { line_type: "header", content: "@@ 1 @@" },
          { line_type: "context", content: "a", old_line_number: 1, new_line_number: 1 },
          { line_type: "removed", content: "b", old_line_number: 2 },
          { line_type: "header", content: "@@ 2 @@" },
          { line_type: "added", content: "c", new_line_number: 9 },
          { line_type: "context", content: "d" },
        ] as GitDiffLine[],
      }),
    );

    expect(result).toEqual({
      content: "a\nb\n\nc\nd",
      lineKinds: ["context", "removed", "spacer", "added", "context"],
      actualLines: [1, 2, null, 9, null],
    });
  });

  it("separates hunks when a hunk ends with an empty context line", () => {
    const result = serializeGitDiffSourceForEditor(
      makeDiff({
        lines: [
          { line_type: "header", content: "@@ 1 @@" },
          { line_type: "context", content: "", old_line_number: 1, new_line_number: 1 },
          { line_type: "header", content: "@@ 2 @@" },
          { line_type: "added", content: "c", new_line_number: 9 },
        ] as GitDiffLine[],
      }),
    );

    expect(result.lineKinds).toEqual(["context", "spacer", "added"]);
    expect(result.actualLines).toEqual([1, null, 9]);
  });
});

describe("serializeGitDiffSourceForSplitEditor", () => {
  it("aligns removed and added lines against spacers on the opposite side", () => {
    const result = serializeGitDiffSourceForSplitEditor(
      makeDiff({
        lines: [
          { line_type: "header", content: "@@ 1 @@" },
          { line_type: "context", content: "a", old_line_number: 1, new_line_number: 1 },
          { line_type: "removed", content: "b", old_line_number: 2 },
          { line_type: "added", content: "c", new_line_number: 2 },
          { line_type: "context", content: "e", old_line_number: 3, new_line_number: 3 },
          { line_type: "header", content: "@@ 2 @@" },
          { line_type: "context", content: "d", old_line_number: 7 },
        ] as GitDiffLine[],
      }),
    );

    expect(result.left).toEqual({
      content: "a\nb\n\ne\n\nd",
      lineKinds: ["context", "removed", "spacer", "context", "spacer", "context"],
      actualLines: [1, 2, null, 3, null, 7],
    });
    expect(result.right).toEqual({
      content: "a\n\nc\ne\n\nd",
      lineKinds: ["context", "spacer", "added", "context", "spacer", "context"],
      actualLines: [1, null, 2, 3, null, 7],
    });
  });

  it("separates hunks on both sides when a hunk ends with an added line", () => {
    const result = serializeGitDiffSourceForSplitEditor(
      makeDiff({
        lines: [
          { line_type: "removed", content: "b", old_line_number: 2 },
          { line_type: "added", content: "c", new_line_number: 2 },
          { line_type: "header", content: "@@ 2 @@" },
          { line_type: "context", content: "d", old_line_number: 7 },
        ] as GitDiffLine[],
      }),
    );

    expect(result.left.content.split("\n")).toEqual(["b", "", "", "d"]);
    expect(result.left.lineKinds).toEqual(["removed", "spacer", "spacer", "context"]);
    expect(result.right.content.split("\n")).toEqual(["", "c", "", "d"]);
    expect(result.right.lineKinds).toEqual(["spacer", "added", "spacer", "context"]);
  });

  it("separates hunks when a hunk ends with an empty context line", () => {
    const result = serializeGitDiffSourceForSplitEditor(
      makeDiff({
        lines: [
          { line_type: "context", content: "", old_line_number: 1, new_line_number: 1 },
          { line_type: "header", content: "@@ 2 @@" },
          { line_type: "context", content: "d", old_line_number: 7, new_line_number: 7 },
        ] as GitDiffLine[],
      }),
    );

    expect(result.left.lineKinds).toEqual(["context", "spacer", "context"]);
    expect(result.right.lineKinds).toEqual(["context", "spacer", "context"]);
  });
});

describe("multi-file diff serialization", () => {
  it("prefixes each file with a parseable accordion line", () => {
    const multiDiff = {
      files: [
        makeDiff(),
        makeDiff({ file_path: "b.ts", old_path: "a.ts", new_path: "b.ts", is_renamed: true }),
        makeDiff({ file_path: "n.ts", old_path: undefined, new_path: "n.ts", is_new: true }),
        makeDiff({ file_path: "d.ts", old_path: "d.ts", new_path: undefined, is_deleted: true }),
      ],
    } as MultiFileDiff;

    const blocks = serializeMultiFileDiffForEditor(multiDiff).split("\n\n");
    const metas = blocks.map((block) => parseDiffAccordionLine(block.split("\n")[0]));

    expect(metas).toEqual([
      { name: "app.ts", path: "src/app.ts", status: "modified", collapsed: false },
      { name: "b.ts", path: "b.ts", status: "renamed", collapsed: false },
      { name: "n.ts", path: "n.ts", status: "added", collapsed: false },
      { name: "d.ts", path: "d.ts", status: "deleted", collapsed: false },
    ]);
  });

  it("rejects lines that are not accordion lines", () => {
    const line = serializeMultiFileDiffForEditor({ files: [makeDiff()] } as MultiFileDiff).split(
      "\n",
    )[0];

    expect(parseDiffAccordionLine("+added line")).toBeNull();
    expect(parseDiffAccordionLine(`${line.slice(0, line.indexOf("{"))}{broken`)).toBeNull();
  });

  it("builds a stable virtual editor path", () => {
    expect(getDiffEditorPath("src/app.ts", "abc")).toBe("diff-editor://abc/app.ts.diff");
    expect(getDiffEditorPath(undefined, "abc")).toBe("diff-editor://abc/diff.diff");
  });
});

describe("formatDiffBufferLabel", () => {
  it("decodes encoded names", () => {
    expect(formatDiffBufferLabel("my%20file.ts")).toBe("my file.ts");
    expect(formatDiffBufferLabel("bad%E0%A4%A")).toBe("bad%E0%A4%A");
  });

  it.each([
    ["diff://staged/src%2Fapp.ts", "app.ts (staged)"],
    ["diff://unstaged/README.md", "README.md (unstaged)"],
    ["diff://commit/abcdef123456/all-files", "Commit abcdef1"],
    ["diff://stash/3/all-files", "Stash @{3}"],
    ["diff://working-tree/all-files", "Uncommitted Changes"],
    ["diff://pr-42/changes", "PR #42 Changes"],
  ])("derives a label from %s", (path, label) => {
    expect(formatDiffBufferLabel("buffer", path)).toBe(label);
  });

  it("keeps the name for unknown or non-diff paths", () => {
    expect(formatDiffBufferLabel("Name", "diff://branch/x/all-files")).toBe("Name");
    expect(formatDiffBufferLabel("Name", "/repo/a.ts")).toBe("Name");
    expect(formatDiffBufferLabel("Name")).toBe("Name");
  });
});
