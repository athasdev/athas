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
  keyword: "token-keyword",
  "keyword.control": "token-keyword",
  "keyword.function": "token-keyword",
  "keyword.operator": "token-keyword",
  "keyword.return": "token-keyword",
  "keyword.import": "token-keyword",

  // Functions
  function: "token-function",
  "function.call": "token-function",
  "function.method": "token-function",
  "function.builtin": "token-function",
  method: "token-function",
  "method.call": "token-function",

  // Variables
  variable: "token-variable",
  "variable.builtin": "token-variable",
  "variable.parameter": "token-variable",
  parameter: "token-variable",

  // Constants
  constant: "token-constant",
  "constant.builtin": "token-constant",
  "constant.numeric": "token-number",
  number: "token-number",
  float: "token-number",
  boolean: "token-constant",

  // Strings
  string: "token-string",
  "string.special": "token-string",
  "string.escape": "token-string",
  character: "token-string",

  // Comments
  comment: "token-comment",
  "comment.line": "token-comment",
  "comment.block": "token-comment",
  "comment.documentation": "token-comment",

  // Types
  type: "token-type",
  "type.builtin": "token-type",
  "type.definition": "token-type",
  class: "token-type",
  interface: "token-type",
  enum: "token-type",
  struct: "token-type",

  // Properties
  property: "token-property",
  "property.definition": "token-property",
  attribute: "token-attribute",
  field: "token-property",

  // Tags (HTML/XML)
  tag: "token-tag",
  "tag.attribute": "token-attribute",
  "tag.delimiter": "token-punctuation",

  // Operators
  operator: "token-operator",
  "operator.arithmetic": "token-operator",
  "operator.logical": "token-operator",

  // Punctuation
  punctuation: "token-punctuation",
  "punctuation.delimiter": "token-punctuation",
  "punctuation.bracket": "token-punctuation",
  "punctuation.special": "token-punctuation",

  // Misc
  label: "token-constant",
  namespace: "token-type",
  module: "token-type",
  decorator: "token-attribute",
  annotation: "token-attribute",
  macro: "token-function",
};

/**
 * Get CSS class name for a Tree-sitter capture name
 */
function mapCaptureToClass(captureName: string): string {
  return CAPTURE_TO_CLASS[captureName] || "token-text";
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
      logger.warn(
        "WasmTokenizer",
        `No highlight query for ${languageId} - syntax highlighting disabled. ` +
          `Ensure the highlight query was downloaded with the extension.`,
      );
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
