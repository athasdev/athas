import { describe, expect, it } from "vite-plus/test";
import {
  buildSearchExcerptRenderLines,
  findClosestTextColumn,
} from "../utils/search-excerpt-lines";

describe("search excerpt render lines", () => {
  it("preserves syntax classes while splitting around search highlights", () => {
    const [line] = buildSearchExcerptRenderLines(
      "const needle = 1;",
      [{ start: 0, end: 5, class_name: "token-keyword" }],
      [{ start: 6, end: 12, itemKey: "search.ts:1:0" }],
    );

    expect(line?.segments).toEqual([
      {
        startColumn: 0,
        endColumn: 5,
        text: "const",
        tokenClassName: "token-keyword",
        highlightIndexes: [],
      },
      {
        startColumn: 5,
        endColumn: 6,
        text: " ",
        tokenClassName: undefined,
        highlightIndexes: [],
      },
      {
        startColumn: 6,
        endColumn: 12,
        text: "needle",
        tokenClassName: undefined,
        highlightIndexes: [0],
      },
      {
        startColumn: 12,
        endColumn: 17,
        text: " = 1;",
        tokenClassName: undefined,
        highlightIndexes: [],
      },
    ]);
  });

  it("keeps overlapping token and highlight ranges on the same segments", () => {
    const [line] = buildSearchExcerptRenderLines(
      "identifier",
      [{ start: 0, end: 10, class_name: "token-variable" }],
      [
        { start: 2, end: 6, itemKey: "first" },
        { start: 4, end: 8, itemKey: "second" },
      ],
    );

    expect(
      line?.segments.map(({ text, tokenClassName, highlightIndexes }) => ({
        text,
        tokenClassName,
        highlightIndexes,
      })),
    ).toEqual([
      { text: "id", tokenClassName: "token-variable", highlightIndexes: [] },
      { text: "en", tokenClassName: "token-variable", highlightIndexes: [0] },
      { text: "ti", tokenClassName: "token-variable", highlightIndexes: [0, 1] },
      { text: "fi", tokenClassName: "token-variable", highlightIndexes: [1] },
      { text: "er", tokenClassName: "token-variable", highlightIndexes: [] },
    ]);
  });

  it("clamps malformed ranges and preserves empty excerpt lines", () => {
    const lines = buildSearchExcerptRenderLines(
      "abc\n\nend",
      [
        { start: -4, end: 2, class_name: "token-keyword" },
        { start: 8, end: 4, class_name: "token-string" },
      ],
      [{ start: 2, end: 99, itemKey: "clamped" }],
    );

    expect(lines).toHaveLength(3);
    expect(lines[0]?.segments).toEqual([
      {
        startColumn: 0,
        endColumn: 2,
        text: "ab",
        tokenClassName: "token-keyword",
        highlightIndexes: [],
      },
      {
        startColumn: 2,
        endColumn: 3,
        text: "c",
        tokenClassName: undefined,
        highlightIndexes: [0],
      },
    ]);
    expect(lines[1]).toEqual({ text: "", segments: [] });
    expect(lines[2]?.segments[0]?.highlightIndexes).toEqual([0]);
  });

  it("finds the nearest text column without assuming fixed character widths", () => {
    const measurePrefix = (text: string) => text.length * 10;

    expect(findClosestTextColumn("abcd", -1, measurePrefix)).toBe(0);
    expect(findClosestTextColumn("abcd", 14, measurePrefix)).toBe(1);
    expect(findClosestTextColumn("abcd", 16, measurePrefix)).toBe(2);
    expect(findClosestTextColumn("abcd", 100, measurePrefix)).toBe(4);
  });
});
