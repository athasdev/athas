import { describe, expect, test } from "vite-plus/test";
import type { GitDiff, GitDiffLine } from "../types/git-types";
import {
  getSplitLineMeta,
  getLineBackground,
  getGutterBackground,
  getContentColor,
} from "../components/diff/git-diff-line";
import { serializeGitDiffSourceForSplitEditor } from "../utils/diff-editor-content";

const makeLine = (
  overrides: Partial<GitDiffLine> & Pick<GitDiffLine, "line_type">,
): GitDiffLine => ({
  content: overrides.content ?? "code",
  ...overrides,
});

describe("getSplitLineMeta", () => {
  test("added line on left side is spacer", () => {
    const meta = getSplitLineMeta(
      makeLine({ line_type: "added", new_line_number: 3 }),
      "left",
    );
    expect(meta.isVisible).toBe(false);
    expect(meta.diffType).toBe("spacer");
  });

  test("added line on right side is added", () => {
    const meta = getSplitLineMeta(
      makeLine({ line_type: "added", new_line_number: 3 }),
      "right",
    );
    expect(meta.isVisible).toBe(true);
    expect(meta.diffType).toBe("added");
  });

  test("removed line on left side is removed", () => {
    const meta = getSplitLineMeta(
      makeLine({ line_type: "removed", old_line_number: 5 }),
      "left",
    );
    expect(meta.isVisible).toBe(true);
    expect(meta.diffType).toBe("removed");
  });

  test("removed line on right side is spacer", () => {
    const meta = getSplitLineMeta(
      makeLine({ line_type: "removed", old_line_number: 5 }),
      "right",
    );
    expect(meta.isVisible).toBe(false);
    expect(meta.diffType).toBe("spacer");
  });

  test("context line on left side is context", () => {
    const meta = getSplitLineMeta(
      makeLine({ line_type: "context", old_line_number: 4, new_line_number: 6 }),
      "left",
    );
    expect(meta.isVisible).toBe(true);
    expect(meta.diffType).toBe("context");
  });

  test("context line on right side is context", () => {
    const meta = getSplitLineMeta(
      makeLine({ line_type: "context", old_line_number: 4, new_line_number: 6 }),
      "right",
    );
    expect(meta.isVisible).toBe(true);
    expect(meta.diffType).toBe("context");
  });
});

describe("serializeGitDiffSourceForSplitEditor context line mapping", () => {
  test("left panel uses old_line_number and right uses new_line_number", () => {
    const diff: GitDiff = {
      file_path: "test.ts",
      is_new: false,
      is_deleted: false,
      is_renamed: false,
      lines: [
        { line_type: "context", content: "shared", old_line_number: 5, new_line_number: 7 },
      ],
    };
    const result = serializeGitDiffSourceForSplitEditor(diff);
    expect(result.left.actualLines[0]).toBe(5);
    expect(result.right.actualLines[0]).toBe(7);
  });
});

describe("styling functions handle spacer type", () => {
  test("getLineBackground returns muted background for spacer", () => {
    expect(getLineBackground("spacer")).toBe("bg-secondary-bg/40");
  });

  test("getGutterBackground returns muted background for spacer", () => {
    expect(getGutterBackground("spacer")).toBe("bg-secondary-bg/50");
  });

  test("getContentColor returns empty for spacer", () => {
    expect(getContentColor("spacer")).toBe("");
  });
});
