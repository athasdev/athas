/**
 * Syntax tokenization hook with support for incremental tokenization
 * Uses WASM Tree-sitter parsers loaded from IndexedDB
 */

import { useCallback, useRef, useState } from "react";
import { getQueryCdnUrl, getWasmCdnUrl, hasCdnConfig } from "@/extensions/languages/parser-cdn";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { logger } from "@/features/editor/utils/logger";
import { indexedDBParserCache } from "../lib/wasm-parser/cache-indexeddb";
import { tokenizeCode, tokenizeRange as wasmTokenizeRange } from "../lib/wasm-parser/tokenizer";
import type { HighlightToken } from "../lib/wasm-parser/types";
import { buildLineOffsetMap, normalizeLineEndings, type Token } from "../utils/html";
import type { ViewportRange } from "./use-viewport-lines";

interface TokenizerOptions {
  filePath: string | undefined;
  enabled?: boolean;
  incremental?: boolean;
}

interface TokenCache {
  fullTokens: Token[];
  lastFullTokenizeTime: number;
}

/**
 * Map file extensions to Tree-sitter language IDs
 */
const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  py: "python",
  rs: "rust",
  go: "go",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hxx: "cpp",
  cs: "c_sharp",
  rb: "ruby",
  php: "php",
  html: "html",
  htm: "html",
  css: "css",
  scss: "css",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  md: "markdown",
  markdown: "markdown",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  swift: "swift",
  kt: "kotlin",
  kts: "kotlin",
  scala: "scala",
  lua: "lua",
  dart: "dart",
  ex: "elixir",
  exs: "elixir",
  ml: "ocaml",
  mli: "ocaml",
  sol: "solidity",
  zig: "zig",
  vue: "vue",
  erb: "embedded_template",
};

function getExtension(path: string): string {
  const parts = path.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
}

export function getLanguageId(filePath: string): string | null {
  const ext = getExtension(filePath);
  return EXTENSION_TO_LANGUAGE[ext] || null;
}

/**
 * Get WASM path for a language - uses CDN if configured, otherwise local
 */
function getWasmPath(languageId: string): string {
  // Check if this language has CDN configuration
  const cdnUrl = getWasmCdnUrl(languageId);
  if (cdnUrl) {
    return cdnUrl;
  }

  // Fall back to local paths
  // TypeScript and JavaScript both use tsx parser
  if (languageId === "typescript" || languageId === "javascript") {
    return "/tree-sitter/parsers/tree-sitter-tsx.wasm";
  }
  return `/tree-sitter/parsers/tree-sitter-${languageId}.wasm`;
}

/**
 * Get highlight query URL for a language - uses CDN if configured, otherwise local
 */
function getQueryUrl(languageId: string): string {
  // Check if this language has CDN configuration
  const cdnUrl = getQueryCdnUrl(languageId);
  if (cdnUrl) {
    return cdnUrl;
  }

  // Fall back to local paths
  const queryFolder =
    languageId === "typescript" || languageId === "javascript" ? "tsx" : languageId;
  return `/tree-sitter/queries/${queryFolder}/highlights.scm`;
}

/**
 * Validate that a string is a valid tree-sitter query (not HTML or other error response)
 */
function isValidHighlightQuery(text: string | undefined): boolean {
  if (!text || text.trim().length === 0) return false;
  // Reject HTML responses (common 404 error pages)
  if (text.trimStart().startsWith("<!") || text.trimStart().startsWith("<html")) return false;
  // Valid queries start with comments (;), patterns ([ or (), or string literals (")
  const trimmed = text.trimStart();
  return (
    trimmed.startsWith(";") ||
    trimmed.startsWith("[") ||
    trimmed.startsWith("(") ||
    trimmed.startsWith('"')
  );
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

export function useTokenizer({ filePath, enabled = true, incremental = true }: TokenizerOptions) {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(false);
  const cacheRef = useRef<TokenCache>({ fullTokens: [], lastFullTokenizeTime: 0 });

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

        let wasmPath: string;
        let highlightQuery: string | undefined;

        if (cached) {
          // Use cached config - prefer cached sourceUrl, fall back to CDN or local
          wasmPath = cached.sourceUrl || getWasmPath(languageId);
          highlightQuery = isValidHighlightQuery(cached.highlightQuery)
            ? cached.highlightQuery
            : undefined;

          // Try to load highlight query if not cached or invalid
          if (!highlightQuery) {
            const queryPath = getQueryUrl(languageId);
            try {
              const response = await fetch(queryPath);
              if (response.ok) {
                const queryText = await response.text();
                if (isValidHighlightQuery(queryText)) {
                  highlightQuery = queryText;
                  // Update cache with the loaded query
                  await indexedDBParserCache.set({
                    ...cached,
                    highlightQuery,
                  });
                  logger.info("Editor", `[Tokenizer] Loaded highlight query from ${queryPath}`);
                } else {
                  logger.warn("Editor", `[Tokenizer] Invalid highlight query from ${queryPath}`);
                }
              }
            } catch {
              logger.warn("Editor", `[Tokenizer] Failed to load highlight query from ${queryPath}`);
            }
          }
        } else {
          // Parser not in IndexedDB - load from CDN or local path
          wasmPath = getWasmPath(languageId);
          const isCdn = hasCdnConfig(languageId);
          logger.info(
            "Editor",
            `[Tokenizer] Parser for ${languageId} not in cache, loading from ${isCdn ? "CDN" : "local"}`,
          );

          // Load highlight query
          const queryPath = getQueryUrl(languageId);
          try {
            const response = await fetch(queryPath);
            if (response.ok) {
              const queryText = await response.text();
              if (isValidHighlightQuery(queryText)) {
                highlightQuery = queryText;
              } else {
                logger.warn("Editor", `[Tokenizer] Invalid highlight query from ${queryPath}`);
              }
            }
          } catch {
            logger.warn("Editor", `[Tokenizer] Failed to load highlight query from ${queryPath}`);
          }
        }

        // Load and tokenize using WASM
        const highlightTokens = await tokenizeCode(normalizedText, languageId, {
          languageId,
          wasmPath,
          highlightQuery,
        });

        // Convert to Token format
        const result = highlightTokens.map(convertToToken);

        setTokens(result);
        cacheRef.current = {
          fullTokens: result,
          lastFullTokenizeTime: Date.now(),
        };
      } catch (error) {
        logger.warn("Editor", "[Tokenizer] Full tokenization failed:", error);
        setTokens([]);
      } finally {
        setLoading(false);
      }
    },
    [enabled, filePath],
  );

  /**
   * Tokenize only a specific line range (incremental)
   */
  const tokenizeRangeInternal = useCallback(
    async (text: string, viewportRange: ViewportRange) => {
      if (!enabled || !filePath) return;

      const languageId = getLanguageId(filePath);
      if (!languageId) return;

      const lineCount = text.split("\n").length;

      // For small files, always tokenize fully
      if (lineCount < EDITOR_CONSTANTS.SMALL_FILE_THRESHOLD) {
        return tokenizeFull(text);
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

        let wasmPath: string;
        let highlightQuery: string | undefined;

        if (cached) {
          // Use cached config - prefer cached sourceUrl, fall back to CDN or local
          wasmPath = cached.sourceUrl || getWasmPath(languageId);
          highlightQuery = isValidHighlightQuery(cached.highlightQuery)
            ? cached.highlightQuery
            : undefined;

          // Try to load highlight query if not cached or invalid
          if (!highlightQuery) {
            const queryPath = getQueryUrl(languageId);
            try {
              const response = await fetch(queryPath);
              if (response.ok) {
                const queryText = await response.text();
                if (isValidHighlightQuery(queryText)) {
                  highlightQuery = queryText;
                  // Update cache with the loaded query
                  await indexedDBParserCache.set({
                    ...cached,
                    highlightQuery,
                  });
                }
              }
            } catch {
              logger.warn("Editor", `[Tokenizer] Failed to load highlight query from ${queryPath}`);
            }
          }
        } else {
          // Parser not in IndexedDB - load from CDN or local path
          wasmPath = getWasmPath(languageId);

          // Load highlight query
          const queryPath = getQueryUrl(languageId);
          try {
            const response = await fetch(queryPath);
            if (response.ok) {
              const queryText = await response.text();
              if (isValidHighlightQuery(queryText)) {
                highlightQuery = queryText;
              }
            }
          } catch {
            logger.warn("Editor", `[Tokenizer] Failed to load highlight query from ${queryPath}`);
          }
        }

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

        // Use cached line offset map for O(1) lookups instead of O(n) reduce
        const lineOffsets = buildLineOffsetMap(text);
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

        // Update cache with merged tokens
        cacheRef.current.fullTokens = mergedTokens;
      } catch (error) {
        logger.warn(
          "Editor",
          "[Tokenizer] Range tokenization failed, falling back to full:",
          error,
        );
        tokenizeFull(text);
      } finally {
        setLoading(false);
      }
    },
    [enabled, filePath, tokenizeFull],
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

  return { tokens, loading, tokenize, forceFullTokenize };
}
