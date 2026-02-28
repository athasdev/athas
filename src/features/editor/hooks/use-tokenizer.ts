/**
 * Syntax tokenization hook with support for incremental tokenization
 * Uses WASM Tree-sitter parsers loaded from IndexedDB
 */

import { useCallback, useRef, useState } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { logger } from "@/features/editor/utils/logger";
import { indexedDBParserCache, type ParserCacheEntry } from "../lib/wasm-parser/cache-indexeddb";
import { fetchHighlightQuery, getDefaultParserWasmUrl } from "../lib/wasm-parser/extension-assets";
import {
  tokenizeCodeWithTree,
  tokenizeRange as wasmTokenizeRange,
} from "../lib/wasm-parser/tokenizer";
import type { HighlightToken } from "../lib/wasm-parser/types";
import { useTreeCacheStore } from "../stores/tree-cache-store";
import { buildLineOffsetMap, normalizeLineEndings, type Token } from "../utils/html";
import { getLanguageIdFromPath } from "../utils/language-id";
import { usePerformanceMonitor } from "./use-performance";
import type { ViewportRange } from "./use-viewport-lines";

interface TokenizerOptions {
  filePath: string | undefined;
  bufferId?: string;
  enabled?: boolean;
  incremental?: boolean;
}

interface TokenCache {
  fullTokens: Token[];
  lastFullTokenizeTime: number;
  previousContent: string;
}

interface TextMetricsCache {
  text: string;
  normalizedText: string;
  lineOffsets: number[];
  lineCount: number;
}

const QUERY_REFRESHED_THIS_SESSION = new Set<string>();

export function getLanguageId(filePath: string): string | null {
  return getLanguageIdFromPath(filePath);
}

function shouldRefreshLegacyHighlightQuery(languageId: string, queryText: string): boolean {
  if (!queryText.trim()) {
    return true;
  }

  // Existing TypeScript query in old installs was too limited, refresh from local extension.
  if (languageId === "typescript" && queryText.trim().length < 1000) {
    return true;
  }

  // Older cached C++ queries can reference nodes not present in the shipped parser.
  if (languageId === "cpp" && queryText.includes("(module_name")) {
    return true;
  }

  return false;
}

async function resolveHighlightQuery(
  languageId: string,
  cached?: ParserCacheEntry,
): Promise<string> {
  let highlightQuery = cached?.highlightQuery || "";
  const shouldTryRefresh =
    shouldRefreshLegacyHighlightQuery(languageId, highlightQuery) ||
    !QUERY_REFRESHED_THIS_SESSION.has(languageId) ||
    !highlightQuery.trim();

  if (!shouldTryRefresh) {
    return highlightQuery;
  }

  try {
    const { query: latestQuery, sourceUrl } = await fetchHighlightQuery(languageId, {
      wasmUrl: cached?.sourceUrl,
      cacheMode: "no-store",
    });

    if (!latestQuery.trim()) {
      QUERY_REFRESHED_THIS_SESSION.add(languageId);
      return highlightQuery;
    }

    if (cached && latestQuery !== highlightQuery) {
      await indexedDBParserCache.set({
        ...cached,
        highlightQuery: latestQuery,
      });
      logger.info(
        "Editor",
        `[Tokenizer] Refreshed highlight query from ${sourceUrl || "fallback source"}`,
      );
      highlightQuery = latestQuery;
    } else if (!cached) {
      highlightQuery = latestQuery;
    }

    QUERY_REFRESHED_THIS_SESSION.add(languageId);
  } catch {
    logger.warn("Editor", `[Tokenizer] Failed to refresh highlight query for ${languageId}`);
    QUERY_REFRESHED_THIS_SESSION.add(languageId);
  }

  return highlightQuery;
}

/**
 * Convert WASM HighlightToken to Token format used by the editor
 */
function convertToToken(highlightToken: HighlightToken): Token {
  return {
    start: highlightToken.startIndex,
    end: highlightToken.endIndex,
    class_name: highlightToken.type,
  };
}

const FULL_TOKENIZE_INTERVAL = 30000; // Re-tokenize full document every 30 seconds
const LARGE_FILE_LINE_THRESHOLD = 20000; // Use viewport-only strategy for very large files

export function useTokenizer({
  filePath,
  bufferId,
  enabled = true,
  incremental = true,
}: TokenizerOptions) {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [tokenizedContent, setTokenizedContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const cacheRef = useRef<TokenCache>({
    fullTokens: [],
    lastFullTokenizeTime: 0,
    previousContent: "",
  });
  const textMetricsRef = useRef<TextMetricsCache | null>(null);
  const treeCacheActions = useTreeCacheStore.use.actions();
  const { startMeasure, endMeasure } = usePerformanceMonitor("Tokenizer");

  const getTextMetrics = useCallback((text: string): TextMetricsCache => {
    const cached = textMetricsRef.current;
    if (cached && cached.text === text) {
      return cached;
    }

    const normalizedText = normalizeLineEndings(text);
    const lineOffsets = buildLineOffsetMap(text);
    const nextMetrics: TextMetricsCache = {
      text,
      normalizedText,
      lineOffsets,
      lineCount: lineOffsets.length,
    };
    textMetricsRef.current = nextMetrics;
    return nextMetrics;
  }, []);

  /**
   * Tokenize the full document using WASM parser
   */
  const tokenizeFull = useCallback(
    async (text: string) => {
      if (!enabled || !filePath) return;

      const languageId = getLanguageId(filePath);
      if (!languageId) {
        logger.warn("Editor", `[Tokenizer] No language mapping for ${filePath}`);
        setTokens([]);
        return;
      }

      setLoading(true);
      try {
        // Check if parser is in IndexedDB cache
        const cached = await indexedDBParserCache.get(languageId);

        // Normalize line endings before tokenizing
        const normalizedText = normalizeLineEndings(text);
        startMeasure(`tokenizeFull (len: ${normalizedText.length})`);

        const wasmPath = cached?.sourceUrl || getDefaultParserWasmUrl(languageId);
        const highlightQuery = await resolveHighlightQuery(languageId, cached || undefined);

        if (!cached) {
          logger.info("Editor", `[Tokenizer] Using remote parser source for ${languageId}`);
        }

        // Always do full parse - incremental parsing disabled for now
        // The debouncing provides sufficient performance improvement
        const parseResult = await tokenizeCodeWithTree(normalizedText, languageId, {
          languageId,
          wasmPath,
          highlightQuery,
        });

        // Cache the tree for potential future use
        if (bufferId && parseResult.tree) {
          treeCacheActions.setTree(bufferId, parseResult.tree, normalizedText.length, languageId);
        }

        // Convert to Token format
        const newTokens = parseResult.tokens.map(convertToToken);

        // Update tokens and content together to keep them in sync
        setTokens(newTokens);
        setTokenizedContent(normalizedText);
        cacheRef.current = {
          fullTokens: newTokens,
          lastFullTokenizeTime: Date.now(),
          previousContent: normalizedText,
        };
      } catch (error) {
        logger.warn("Editor", "[Tokenizer] Full tokenization failed:", error);
        setTokens([]);
        setTokenizedContent("");
      } finally {
        setLoading(false);
        endMeasure(`tokenizeFull (len: ${normalizeLineEndings(text).length})`);
      }
    },
    [enabled, filePath, bufferId, treeCacheActions],
  );

  /**
   * Tokenize only a specific line range (incremental)
   */
  const tokenizeRangeInternal = useCallback(
    async (text: string, viewportRange: ViewportRange) => {
      if (!enabled || !filePath) return;

      const languageId = getLanguageId(filePath);
      if (!languageId) return;

      startMeasure("tokenizeRangeInternal");

      const { normalizedText, lineOffsets, lineCount } = getTextMetrics(text);

      // For small files, always tokenize fully
      if (lineCount < EDITOR_CONSTANTS.SMALL_FILE_THRESHOLD) {
        return tokenizeFull(text);
      }

      // For very large files, keep tokenization strictly viewport-scoped to avoid
      // repeatedly merging/sorting huge token arrays while scrolling.
      if (lineCount >= LARGE_FILE_LINE_THRESHOLD) {
        setLoading(true);
        try {
          const cached = await indexedDBParserCache.get(languageId);
          const wasmPath = cached?.sourceUrl || getDefaultParserWasmUrl(languageId);
          const highlightQuery = await resolveHighlightQuery(languageId, cached || undefined);

          const clampedStartLine = Math.max(0, Math.min(viewportRange.startLine, lineCount - 1));
          const clampedEndLine = Math.max(
            clampedStartLine + 1,
            Math.min(viewportRange.endLine, lineCount),
          );

          const highlightTokens = await wasmTokenizeRange(
            text,
            languageId,
            clampedStartLine,
            clampedEndLine,
            {
              languageId,
              wasmPath,
              highlightQuery,
            },
          );

          const rangeTokens = highlightTokens.map(convertToToken);
          setTokens(rangeTokens);
          setTokenizedContent(normalizedText);
          cacheRef.current = {
            fullTokens: rangeTokens,
            lastFullTokenizeTime: Date.now(),
            previousContent: normalizedText,
          };
        } catch (error) {
          logger.warn("Editor", "[Tokenizer] Large-file viewport tokenization failed:", error);
          setTokens([]);
          setTokenizedContent(normalizedText);
        } finally {
          setLoading(false);
          endMeasure("tokenizeRangeInternal");
        }
        return;
      }

      // Check if we need a full re-tokenize (periodic refresh)
      const timeSinceLastFull = Date.now() - cacheRef.current.lastFullTokenizeTime;
      if (timeSinceLastFull > FULL_TOKENIZE_INTERVAL) {
        return tokenizeFull(text);
      }

      setLoading(true);
      try {
        // Check if parser is in IndexedDB cache
        const cached = await indexedDBParserCache.get(languageId);
        if (!cached) {
          logger.warn(
            "Editor",
            `[Tokenizer] Parser not in cache for ${languageId}, falling back to full tokenization`,
          );
          return tokenizeFull(text);
        }

        // Use cached config
        const wasmPath = cached.sourceUrl;
        const highlightQuery = await resolveHighlightQuery(languageId, cached);

        // Tokenize the viewport range
        const highlightTokens = await wasmTokenizeRange(
          text,
          languageId,
          viewportRange.startLine,
          viewportRange.endLine,
          {
            languageId,
            wasmPath,
            highlightQuery,
          },
        );

        const rangeTokens = highlightTokens.map(convertToToken);

        // Merge with cached tokens from outside the viewport
        const { fullTokens } = cacheRef.current;

        const rangeStartOffset = lineOffsets[viewportRange.startLine] || 0;
        const rangeEndOffset = lineOffsets[viewportRange.endLine] || text.length;

        // Filter out cached tokens that overlap with the new range
        const cachedTokensOutsideRange = fullTokens.filter(
          (token) => token.end <= rangeStartOffset || token.start >= rangeEndOffset,
        );

        // Combine cached tokens with new range tokens
        const mergedTokens = [...cachedTokensOutsideRange, ...rangeTokens].sort(
          (a, b) => a.start - b.start,
        );

        setTokens(mergedTokens);
        setTokenizedContent(normalizedText);

        // Update cache with merged tokens and previous content
        cacheRef.current.fullTokens = mergedTokens;
        cacheRef.current.previousContent = normalizedText;
      } catch (error) {
        logger.warn(
          "Editor",
          "[Tokenizer] Range tokenization failed, falling back to full:",
          error,
        );
        tokenizeFull(text);
      } finally {
        setLoading(false);
        endMeasure("tokenizeRangeInternal");
      }
    },
    [enabled, filePath, getTextMetrics, tokenizeFull],
  );

  /**
   * Main tokenize function - chooses between full and incremental
   */
  const tokenize = useCallback(
    async (text: string, viewportRange?: ViewportRange) => {
      if (!incremental || !viewportRange) {
        return tokenizeFull(text);
      }

      return tokenizeRangeInternal(text, viewportRange);
    },
    [incremental, tokenizeFull, tokenizeRangeInternal],
  );

  /**
   * Force a full re-tokenization
   */
  const forceFullTokenize = useCallback(
    async (text: string) => {
      return tokenizeFull(text);
    },
    [tokenizeFull],
  );

  return { tokens, tokenizedContent, loading, tokenize, forceFullTokenize };
}
