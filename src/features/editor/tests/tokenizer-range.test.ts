import { describe, expect, it } from "vite-plus/test";
import { filterTokensToRange, intersectsTokenizerRange } from "../lib/wasm-parser/tokenizer-range";
import type { HighlightToken } from "../types/wasm-parser/wasm-parser.types";

const range = {
  startPosition: { row: 10, column: 0 },
  endPosition: { row: 20, column: Number.MAX_SAFE_INTEGER },
  startIndex: 100,
  endIndex: 200,
};

describe("tokenizer range filtering", () => {
  it("keeps intersecting captures and injections at both range edges", () => {
    expect(intersectsTokenizerRange({ startIndex: 90, endIndex: 101 }, range)).toBe(true);
    expect(intersectsTokenizerRange({ startIndex: 199, endIndex: 220 }, range)).toBe(true);
    expect(intersectsTokenizerRange({ startIndex: 0, endIndex: 100 }, range)).toBe(false);
    expect(intersectsTokenizerRange({ startIndex: 200, endIndex: 250 }, range)).toBe(false);
  });

  it("filters overlay tokens to the requested range", () => {
    const token = (startIndex: number, endIndex: number): HighlightToken => ({
      type: "token-variable",
      startIndex,
      endIndex,
      startPosition: { row: 0, column: startIndex },
      endPosition: { row: 0, column: endIndex },
    });

    expect(filterTokensToRange([token(10, 20), token(90, 110), token(210, 220)], range)).toEqual([
      token(90, 110),
    ]);
  });
});
