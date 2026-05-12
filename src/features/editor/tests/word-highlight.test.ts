import { describe, expect, it } from "vite-plus/test";
import { buildLineOffsetMap } from "../utils/html";
import { findWordHighlightRanges } from "../utils/word-highlight";

describe("word highlight ranges", () => {
  it("finds whole-word occurrences for the current word", () => {
    const content = "const value = valueOf(value);\nvalue";

    expect(
      findWordHighlightRanges({
        content,
        cursorOffset: content.indexOf("value"),
        lineOffsets: buildLineOffsetMap(content),
      }),
    ).toEqual([
      { start: 6, end: 11, isCurrent: true },
      { start: 22, end: 27, isCurrent: false },
      { start: 30, end: 35, isCurrent: false },
    ]);
  });

  it("limits scanning to the visible viewport", () => {
    const content = "target\nskip target\nvisible target";

    expect(
      findWordHighlightRanges({
        content,
        cursorOffset: content.indexOf("target"),
        lineOffsets: buildLineOffsetMap(content),
        viewportRange: { startLine: 2, endLine: 3 },
      }),
    ).toEqual([{ start: 27, end: 33, isCurrent: false }]);
  });

  it("ignores very short words by default", () => {
    const content = "a a";

    expect(
      findWordHighlightRanges({
        content,
        cursorOffset: 0,
        lineOffsets: buildLineOffsetMap(content),
      }),
    ).toEqual([]);
  });
});
