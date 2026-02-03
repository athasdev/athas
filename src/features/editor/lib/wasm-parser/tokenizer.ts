/**
 * WASM Tokenizer
 * Provides tokenization API using Tree-sitter WASM parsers
 */

import type { Tree } from "web-tree-sitter";
import { logger } from "../../utils/logger";
import { wasmParserLoader } from "./loader";
import type {
  HighlightToken,
  IncrementalParseOptions,
  LoadedParser,
  ParserConfig,
  TokenizeResult,
} from "./types";

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

  // Markdown
  "text.title": "token-keyword",
  "text.literal": "token-string",
  "text.emphasis": "token-variable",
  "text.strong": "token-constant",
  "text.uri": "token-string",
  "text.reference": "token-function",
  none: "token-text",
};

/**
 * Get CSS class name for a Tree-sitter capture name
 */
function mapCaptureToClass(captureName: string): string {
  return CAPTURE_TO_CLASS[captureName] || "token-text";
}

/**
 * Tokenize code using a WASM parser with optional incremental parsing support.
 * Returns both tokens and the parse tree for caching.
 */
export async function tokenizeCodeWithTree(
  content: string,
  languageId: string,
  config?: ParserConfig,
  incrementalOptions?: IncrementalParseOptions,
): Promise<TokenizeResult> {
  try {
    // Load parser if not already loaded
    let loadedParser: LoadedParser;
    if (config) {
      loadedParser = await wasmParserLoader.loadParser(config);
    } else if (wasmParserLoader.isLoaded(languageId)) {
      // Use already loaded parser
      loadedParser = wasmParserLoader.getParser(languageId);
    } else {
      // Try to load from IndexedDB cache
      const { indexedDBParserCache } = await import("./cache-indexeddb");
      const cached = await indexedDBParserCache.get(languageId);

      if (cached) {
        // Load parser from cache
        logger.debug("WasmTokenizer", `Loading ${languageId} from IndexedDB cache`);
        loadedParser = await wasmParserLoader.loadParser({
          languageId,
          wasmPath: cached.sourceUrl || `indexeddb://${languageId}`, // wasmPath not used when cached
          highlightQuery: cached.highlightQuery,
        });
      } else {
        throw new Error(`Parser for ${languageId} is not loaded and not found in cache`);
      }
    }

    const { parser, highlightQuery } = loadedParser;

    let tree: Tree | null;

    // Use incremental parsing if previous tree and edit are provided
    if (incrementalOptions?.previousTree && incrementalOptions?.edit) {
      try {
        // Copy the tree before editing to avoid mutating the cached tree
        const treeCopy = incrementalOptions.previousTree.copy();
        // Apply the edit to the copy
        treeCopy.edit(incrementalOptions.edit);
        // Parse incrementally using the edited copy
        tree = parser.parse(content, treeCopy);
        // Clean up the copy (the new tree is independent)
        treeCopy.delete();
      } catch (error) {
        // Fall back to full parse if incremental fails
        logger.warn("WasmTokenizer", "Incremental parse failed, falling back to full parse", error);
        tree = parser.parse(content);
      }
    } else {
      // Full parse
      tree = parser.parse(content);
    }

    // Check if parse was successful
    if (!tree) {
      logger.error("WasmTokenizer", `Failed to parse code for ${languageId}`);
      return { tokens: [], tree: null as unknown as TokenizeResult["tree"] };
    }

    // If no highlight query, return empty tokens but keep tree
    if (!highlightQuery) {
      logger.warn(
        "WasmTokenizer",
        `No highlight query for ${languageId} - syntax highlighting disabled. ` +
          `Ensure the highlight query was downloaded with the extension.`,
      );
      return { tokens: [], tree };
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

    return { tokens, tree };
  } catch (error) {
    logger.error("WasmTokenizer", `Failed to tokenize code for ${languageId}`, error);
    throw error;
  }
}

/**
 * Tokenize code using a WASM parser (legacy function, returns only tokens)
 */
export async function tokenizeCode(
  content: string,
  languageId: string,
  config?: ParserConfig,
): Promise<HighlightToken[]> {
  const result = await tokenizeCodeWithTree(content, languageId, config);
  // Delete the tree since caller doesn't need it
  if (result.tree) {
    try {
      result.tree.delete();
    } catch {
      // Tree may already be deleted
    }
  }
  return result.tokens;
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
