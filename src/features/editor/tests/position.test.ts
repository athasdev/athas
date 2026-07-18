import { describe, expect, it } from "vite-plus/test";
import {
  calculateLineColumnFromOffsets,
  findLineIndexForOffset,
  getAccurateCursorX,
  getLineTextFromContent,
  getLineTextsFromContent,
} from "../utils/position";

describe("position utilities", () => {
  it("extracts one line without CRLF terminators", () => {
    expect(getLineTextFromContent("zero\r\none", 0)).toBe("zero");
  });

  it("extracts selected line texts without materializing all lines", () => {
    const content = "zero\none\r\ntwo\nthree";

    expect(getLineTextsFromContent(content, [2, 0, 2, 10, -1])).toEqual(
      new Map([
        [0, "zero"],
        [2, "two"],
      ]),
    );
  });

  it("handles the final line when content has no trailing newline", () => {
    expect(getLineTextsFromContent("alpha\nbeta", [1])).toEqual(new Map([[1, "beta"]]));
  });

  it("maps offsets to line indexes using binary-search line offsets", () => {
    const lineOffsets = [0, 6, 11];

    expect(findLineIndexForOffset(lineOffsets, 0)).toBe(0);
    expect(findLineIndexForOffset(lineOffsets, 6)).toBe(1);
    expect(findLineIndexForOffset(lineOffsets, 10)).toBe(1);
    expect(findLineIndexForOffset(lineOffsets, 99)).toBe(2);
  });

  it("maps offsets to unclamped line columns from line offsets", () => {
    expect(calculateLineColumnFromOffsets(8, [0, 6, 11], 15)).toEqual({
      line: 1,
      column: 2,
    });
  });

  it("expands repeated tabs from the current visual column", () => {
    const width = (text: string, column = text.length) =>
      getAccurateCursorX(text, column, 10, "monospace", 4);

    expect(width("\t")).toBe(width("    "));
    expect(width("\t\t")).toBe(width("        "));
    expect(width("ab\t")).toBe(width("abcd"));
  });
});
