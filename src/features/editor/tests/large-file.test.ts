import { describe, expect, it } from "vite-plus/test";
import {
  applyIncrementalLargeEditorModeInfo,
  countLines,
  createSparseLineArray,
  getLargeEditorModeInfo,
  getLineOffset,
  getLineSlice,
  isTooLargeForEditorServices,
  shouldUseLargeEditorMode,
  sliceContentLines,
} from "../utils/large-file";
import {
  calculateCursorPositionFromContent,
  calculateCursorPositionFromLineOffsets,
  calculateOffsetFromContentPosition,
} from "../utils/position";
import { getUndoEditDelta } from "../history/undo-grouping";

describe("large file editor mode", () => {
  it("uses responsive mode before VS Code hard tokenization limits", () => {
    expect(
      isTooLargeForEditorServices({
        contentLength: 2 * 1024 * 1024,
        lineCount: 10,
      }),
    ).toBe(true);
    expect(isTooLargeForEditorServices({ contentLength: 1024, lineCount: 50_000 })).toBe(true);
  });

  it("keeps normal editor services for ordinary files", () => {
    expect(isTooLargeForEditorServices({ contentLength: 64_000, lineCount: 1_000 })).toBe(false);
    expect(shouldUseLargeEditorMode("const value = 1;\n")).toBe(false);
  });

  it("detects large pasted content without needing a precomputed line array", () => {
    expect(shouldUseLargeEditorMode("x".repeat(2 * 1024 * 1024))).toBe(true);
    expect(shouldUseLargeEditorMode(`${"x\n".repeat(50_000)}`)).toBe(true);
  });

  it("returns large mode and line count in one content scan", () => {
    expect(getLargeEditorModeInfo("one\ntwo")).toEqual({
      lineCount: 2,
      largeContentMode: false,
    });

    expect(getLargeEditorModeInfo(`${"x\n".repeat(50_000)}`).largeContentMode).toBe(true);
  });

  it("updates large mode info incrementally for small edits", () => {
    const previousContent = "one\ntwo\nthree";
    const previousInfo = getLargeEditorModeInfo(previousContent);
    const nextContent = "one\ntwo\ninserted\nthree";

    expect(applyIncrementalLargeEditorModeInfo(previousContent, nextContent, previousInfo)).toEqual(
      getLargeEditorModeInfo(nextContent),
    );
  });

  it("falls back for large large-mode bookkeeping edits", () => {
    const previousContent = "one\ntwo";
    const previousInfo = getLargeEditorModeInfo(previousContent);
    const nextContent = `${previousContent}\n${"x".repeat(1200)}`;

    expect(applyIncrementalLargeEditorModeInfo(previousContent, nextContent, previousInfo)).toBe(
      null,
    );
  });

  it("counts lines without allocating a line array", () => {
    expect(countLines("")).toBe(1);
    expect(countLines("one")).toBe(1);
    expect(countLines("one\ntwo\n")).toBe(3);
  });

  it("creates a line-count placeholder without materializing line strings", () => {
    const lines = createSparseLineArray(150_000);

    expect(lines).toHaveLength(150_000);
    expect(Object.keys(lines)).toHaveLength(0);
  });

  it("reads visible line slices without splitting the whole file", () => {
    const content = "zero\none\ntwo\r\nthree\nfour";

    expect(getLineOffset(content, 3)).toBe("zero\none\ntwo\r\n".length);
    expect(getLineSlice(content, 2)).toEqual({
      line: "two",
      offset: "zero\none\n".length,
    });
    expect(sliceContentLines(content, 1, 4)).toEqual({
      lines: ["one", "two", "three"],
      offsets: [5, 9, 14],
    });
  });

  it("calculates cursor position from large content without a line array", () => {
    const content = `${"x\n".repeat(50_000)}tail`;

    expect(calculateCursorPositionFromContent(content.length, content)).toEqual({
      line: 50_000,
      column: 4,
      offset: content.length,
    });
  });

  it("calculates cursor position at line boundaries", () => {
    const content = "alpha\nbeta\n";
    const lines = ["alpha", "beta", ""];
    const lineOffsets = [0, 6, 11];

    expect(calculateCursorPositionFromContent(0, content)).toEqual({
      line: 0,
      column: 0,
      offset: 0,
    });
    expect(calculateCursorPositionFromContent(6, content)).toEqual({
      line: 1,
      column: 0,
      offset: 6,
    });
    expect(calculateCursorPositionFromContent(999, content)).toEqual({
      line: 2,
      column: 0,
      offset: content.length,
    });
    expect(calculateCursorPositionFromLineOffsets(10, lines, lineOffsets)).toEqual({
      line: 1,
      column: 4,
      offset: 10,
    });
    expect(calculateCursorPositionFromLineOffsets(11, lines, lineOffsets)).toEqual({
      line: 2,
      column: 0,
      offset: 11,
    });
    expect(calculateOffsetFromContentPosition(content, 1, 2)).toBe(8);
    expect(calculateOffsetFromContentPosition(content, 99, 2)).toBe(content.length);
  });

  it("keeps the large paste bookkeeping path allocation-light", () => {
    const content = Array.from({ length: 150_000 }, (_, index) => `int sqlite_${index};`).join(
      "\n",
    );

    expect(shouldUseLargeEditorMode(content)).toBe(true);
    expect(countLines(content)).toBe(150_000);
    expect(calculateCursorPositionFromContent(content.length, content)).toMatchObject({
      line: 149_999,
      column: "int sqlite_149999;".length,
      offset: content.length,
    });

    const undoDelta = getUndoEditDelta("", content);
    expect(undoDelta.operation).toBe("other");
    expect(undoDelta.insertedText).toBe("");
    expect(undoDelta.insertedLength).toBe(content.length);
  });
});
