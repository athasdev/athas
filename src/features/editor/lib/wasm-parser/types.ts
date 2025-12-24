/**
 * Types for WASM-based Tree-sitter parsing
 */

import type { Language, Parser, Query, Tree } from "web-tree-sitter";

export interface HighlightToken {
  type: string;
  startIndex: number;
  endIndex: number;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
}

export interface ParserConfig {
  languageId: string;
  wasmPath: string;
  highlightQuery?: string;
}

export interface LoadedParser {
  parser: Parser;
  language: Language;
  highlightQuery?: Query;
  languageId: string;
}

export interface ParseResult {
  tokens: HighlightToken[];
  tree: Tree;
}
