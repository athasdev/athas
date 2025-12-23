/**
 * Types for WASM-based Tree-sitter parsing
 */

import type { Edit, Language, Parser, Query, Tree } from "web-tree-sitter";

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

/**
 * Options for incremental parsing with Tree-sitter
 */
export interface IncrementalParseOptions {
  /** The previous parse tree to use for incremental parsing */
  previousTree?: Tree;
  /** The edit that was applied to transform the old content to new content */
  edit?: Edit;
}

/**
 * Result of tokenization including the parse tree for caching
 */
export interface TokenizeResult {
  tokens: HighlightToken[];
  tree: Tree;
}
