/**
 * WASM Tokenizer
 * Provides tokenization API using Tree-sitter WASM parsers
 */

import type { Tree } from "web-tree-sitter";
import { logger } from "../../utils/logger";
import { getLanguageAssetConfig } from "./extension-assets";
import { wasmParserLoader } from "./loader";
import { getLanguageOverlayTokens } from "./language-overlays";
import { dedupeHighlightTokens, isIgnoredCapture, mapCaptureToClass } from "./capture-map";
import {
  findInjectionNodes,
  getInjectionRules,
  resolveInjectedLanguage,
} from "./language-injections";
import type {
  HighlightToken,
  IncrementalParseOptions,
  LoadedParser,
  ParserConfig,
  TokenizeResult,
} from "../../types/wasm-parser/wasm-parser.types";

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
      const assets = getLanguageAssetConfig(languageId);
      loadedParser = await wasmParserLoader.loadParser({
        languageId,
        wasmPath: assets.wasmPath,
        highlightQueryUrl: assets.highlightQueryUrl,
      });
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

    // Convert captures to tokens, filtering out Neovim-specific metadata
    // captures that don't correspond to visual highlighting
    const tokens: HighlightToken[] = [];
    for (const capture of captures) {
      const { name } = capture;
      if (isIgnoredCapture(name)) {
        continue;
      }
      const { node } = capture;
      tokens.push({
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
      });
    }

    // Process language injections (e.g. JS inside HTML <script>)
    const injectionRules = getInjectionRules(languageId);
    if (injectionRules) {
      const injectionNodes = findInjectionNodes(tree.rootNode, injectionRules);

      const embeddedTokenGroups = await Promise.all(
        injectionNodes.map(async ({ rule, node, parentNode }) => {
          try {
            const embeddedContent = content.substring(node.startIndex, node.endIndex);
            if (!embeddedContent.trim()) return [];

            const embeddedLanguageId = resolveInjectedLanguage(
              content,
              languageId,
              rule,
              node,
              parentNode,
            );
            const assets = getLanguageAssetConfig(embeddedLanguageId);
            const subTokens = await tokenizeCode(embeddedContent, embeddedLanguageId, {
              languageId: embeddedLanguageId,
              wasmPath: assets.wasmPath,
              highlightQueryUrl: assets.highlightQueryUrl,
            });

            const startOffset = node.startIndex;
            const startRow = node.startPosition.row;
            const startCol = node.startPosition.column;

            for (const token of subTokens) {
              if (token.startPosition.row === 0) {
                token.startPosition.column += startCol;
              }
              if (token.endPosition.row === 0) {
                token.endPosition.column += startCol;
              }
              token.startPosition.row += startRow;
              token.endPosition.row += startRow;
              token.startIndex += startOffset;
              token.endIndex += startOffset;
            }

            return subTokens;
          } catch (error) {
            logger.warn(
              "WasmTokenizer",
              `Failed to tokenize embedded ${rule.language} in ${languageId}`,
              error,
            );
            return [];
          }
        }),
      );

      for (const subTokens of embeddedTokenGroups) {
        tokens.push(...subTokens);
      }
    }

    tokens.push(...getLanguageOverlayTokens(languageId, content));

    // Deduplicate tokens at the same range. Tree-sitter returns captures in
    // pattern order for same-position nodes; later patterns are more specific
    // (e.g. @tag.builtin overrides @variable). Keep the last capture per range.
    return { tokens: dedupeHighlightTokens(tokens), tree };
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
