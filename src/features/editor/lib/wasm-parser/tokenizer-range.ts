import type { HighlightToken } from "../../types/wasm-parser/wasm-parser.types";

export interface TokenizerRangeBounds {
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  startIndex: number;
  endIndex: number;
}

interface IndexedRange {
  startIndex: number;
  endIndex: number;
}

export function intersectsTokenizerRange(value: IndexedRange, range: TokenizerRangeBounds) {
  return value.endIndex > range.startIndex && value.startIndex < range.endIndex;
}

export function filterTokensToRange(
  tokens: HighlightToken[],
  range?: TokenizerRangeBounds,
): HighlightToken[] {
  return range ? tokens.filter((token) => intersectsTokenizerRange(token, range)) : tokens;
}
