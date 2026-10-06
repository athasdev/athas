import { describe, expect, it } from "vite-plus/test";
import { getLineSlice } from "../utils/large-file";
import {
  calculateCursorPositionFromContent,
  calculateCursorPositionFromLineOffsets,
  calculateOffsetFromContentPosition,
  getLineTextFromContent,
} from "../utils/position";

describe("large file editor mode", () => {
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

  it("reads a line from content without materializing every line", () => {
    const content = "alpha\nbeta\ngamma";

    expect(getLineTextFromContent(content, 1)).toBe("beta");
    expect(getLineTextFromContent(content, 99)).toBe("");
  });
});

describe("getLineSlice", () => {
  it("returns a line and its offset, without the CR of CRLF endings", () => {
    const content = "alpha\r\nbeta\ngamma";
    expect(getLineSlice(content, 0)).toEqual({ line: "alpha", offset: 0 });
    expect(getLineSlice(content, 1)).toEqual({ line: "beta", offset: 7 });
    expect(getLineSlice(content, 2)).toEqual({ line: "gamma", offset: 12 });
    expect(getLineSlice(content, 9)).toEqual({ line: "", offset: content.length });
  });
});
