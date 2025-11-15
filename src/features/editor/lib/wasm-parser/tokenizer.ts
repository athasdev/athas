/**
 * WASM Tokenizer
 * Provides tokenization API using Tree-sitter WASM parsers
 */

import { logger } from "../../utils/logger";
import { wasmParserLoader } from "./loader";
import type { HighlightToken, LoadedParser, ParserConfig } from "./types";

/**
 * Map Tree-sitter capture names to CSS class names
 */
const CAPTURE_TO_CLASS: Record<string, string> = {
  // Keywords
  keyword: "syntax-keyword",
  "keyword.control": "syntax-keyword",
  "keyword.function": "syntax-keyword",
  "keyword.operator": "syntax-keyword",
  "keyword.return": "syntax-keyword",
  "keyword.import": "syntax-keyword",

  // Functions
  function: "syntax-function",
  "function.call": "syntax-function",
  "function.method": "syntax-function",
  "function.builtin": "syntax-function",
  method: "syntax-function",
  "method.call": "syntax-function",

  // Variables
  variable: "syntax-variable",
  "variable.builtin": "syntax-variable",
  "variable.parameter": "syntax-variable",
  parameter: "syntax-variable",

  // Constants
  constant: "syntax-constant",
  "constant.builtin": "syntax-constant",
  "constant.numeric": "syntax-number",
  number: "syntax-number",
  float: "syntax-number",
  boolean: "syntax-constant",

  // Strings
  string: "syntax-string",
  "string.special": "syntax-string",
  "string.escape": "syntax-string",
  character: "syntax-string",

  // Comments
  comment: "syntax-comment",
  "comment.line": "syntax-comment",
  "comment.block": "syntax-comment",
  "comment.documentation": "syntax-comment",

  // Types
  type: "syntax-type",
  "type.builtin": "syntax-type",
  "type.definition": "syntax-type",
  class: "syntax-type",
  interface: "syntax-type",
  enum: "syntax-type",
  struct: "syntax-type",

  // Properties
  property: "syntax-property",
  "property.definition": "syntax-property",
  attribute: "syntax-attribute",
  field: "syntax-property",

  // Tags (HTML/XML)
  tag: "syntax-tag",
  "tag.attribute": "syntax-attribute",
  "tag.delimiter": "syntax-punctuation",

  // Operators
  operator: "syntax-keyword",
  "operator.arithmetic": "syntax-keyword",
  "operator.logical": "syntax-keyword",

  // Punctuation
  punctuation: "syntax-punctuation",
  "punctuation.delimiter": "syntax-punctuation",
  "punctuation.bracket": "syntax-punctuation",
  "punctuation.special": "syntax-punctuation",

  // Misc
  label: "syntax-constant",
  namespace: "syntax-type",
  module: "syntax-type",
  decorator: "syntax-attribute",
  annotation: "syntax-attribute",
  macro: "syntax-function",
};

/**
 * Get CSS class name for a Tree-sitter capture name
 */
function mapCaptureToClass(captureName: string): string {
  return CAPTURE_TO_CLASS[captureName] || "syntax-text";
}

/**
 * Tokenize code using a WASM parser
 */
export async function tokenizeCode(
  content: string,
  languageId: string,
  config?: ParserConfig,
): Promise<HighlightToken[]> {
  try {
    // Load parser if not already loaded
    let loadedParser: LoadedParser;
    if (config) {
      loadedParser = await wasmParserLoader.loadParser(config);
    } else {
      // Try to get already loaded parser
      if (!wasmParserLoader.isLoaded(languageId)) {
        throw new Error(`Parser for ${languageId} is not loaded and no config provided`);
      }
      loadedParser = wasmParserLoader.getParser(languageId);
    }

    const { parser, highlightQuery } = loadedParser;

    // Parse the code
    const tree = parser.parse(content);

    // Check if parse was successful
    if (!tree) {
      logger.error("WasmTokenizer", `Failed to parse code for ${languageId}`);
      return [];
    }

    // If no highlight query, return empty tokens
    if (!highlightQuery) {
      logger.warn("WasmTokenizer", `No highlight query for ${languageId}`);
      return [];
    }

    // Get highlights
    const captures = highlightQuery.captures(tree.rootNode);

    // Convert captures to tokens
    const tokens: HighlightToken[] = captures.map((capture) => {
      const { node, name } = capture;
      return {
        type: mapCaptureToClass(name),
        startIndex: node.startIndex,
        endIndex: node.endIndex,
        startPosition: {
          row: node.startPosition.row,
          column: node.startPosition.column,
        },
        endPosition: {
          row: node.endPosition.row,
          column: node.endPosition.column,
        },
      };
    });

    return tokens;
  } catch (error) {
    logger.error("WasmTokenizer", `Failed to tokenize code for ${languageId}`, error);
    throw error;
  }
}

/**
 * Tokenize a specific range of lines
 */
export async function tokenizeRange(
  content: string,
  languageId: string,
  startLine: number,
  endLine: number,
  config?: ParserConfig,
): Promise<HighlightToken[]> {
  // For WASM, we parse the full document and filter tokens
  // Tree-sitter doesn't support partial parsing easily
  const allTokens = await tokenizeCode(content, languageId, config);

  // Filter tokens within the line range
  return allTokens.filter((token) => {
    return token.startPosition.row >= startLine && token.endPosition.row <= endLine;
  });
}

/**
 * Tokenize code by line
 * Returns tokens grouped by line number
 */
export async function tokenizeByLine(
  content: string,
  languageId: string,
  config?: ParserConfig,
): Promise<Map<number, HighlightToken[]>> {
  const allTokens = await tokenizeCode(content, languageId, config);
  const tokensByLine = new Map<number, HighlightToken[]>();

  for (const token of allTokens) {
    // A token might span multiple lines
    for (let line = token.startPosition.row; line <= token.endPosition.row; line++) {
      if (!tokensByLine.has(line)) {
        tokensByLine.set(line, []);
      }
      tokensByLine.get(line)!.push(token);
    }
  }

  return tokensByLine;
}

/**
 * Initialize the WASM tokenizer
 */
export async function initializeWasmTokenizer(): Promise<void> {
  await wasmParserLoader.initialize();
  logger.info("WasmTokenizer", "WASM tokenizer initialized");
}
