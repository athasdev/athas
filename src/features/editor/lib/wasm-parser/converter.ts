/**
 * Token format converter
 * Converts WASM tokens to editor Token format
 */

import type { LanguageToken } from "@/extensions/languages/language-provider-registry";
import type { HighlightToken } from "../../types/wasm-parser/wasm-parser.types";

/**
 * Convert WASM HighlightToken to editor Token format
 */
function convertToEditorToken(highlightToken: HighlightToken): LanguageToken {
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
export function convertToEditorTokens(highlightTokens: HighlightToken[]): LanguageToken[] {
  return highlightTokens.map(convertToEditorToken);
}
