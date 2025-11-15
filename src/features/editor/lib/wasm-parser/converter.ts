/**
 * Token format converter
 * Converts WASM tokens to editor Token format
 */

import type { Token } from "../../extensions/types";
import type { HighlightToken } from "./types";

/**
 * Convert WASM HighlightToken to editor Token format
 */
export function convertToEditorToken(highlightToken: HighlightToken): Token {
  return {
    start: highlightToken.startIndex,
    end: highlightToken.endIndex,
    token_type: highlightToken.type,
    class_name: highlightToken.type,
  };
}

/**
 * Convert array of WASM tokens to editor tokens
 */
export function convertToEditorTokens(highlightTokens: HighlightToken[]): Token[] {
  return highlightTokens.map(convertToEditorToken);
}
