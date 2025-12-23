/**
 * Syntax tokenization hook with support for incremental tokenization
 * Uses WASM Tree-sitter parsers loaded from IndexedDB
 */

import { useCallback, useRef, useState } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { logger } from "@/features/editor/utils/logger";
import { indexedDBParserCache } from "../lib/wasm-parser/cache-indexeddb";
import {
  tokenizeCodeWithTree,
  tokenizeRange as wasmTokenizeRange,
} from "../lib/wasm-parser/tokenizer";
import type { HighlightToken } from "../lib/wasm-parser/types";
import { useTreeCacheStore } from "../stores/tree-cache-store";
import { buildLineOffsetMap, normalizeLineEndings, type Token } from "../utils/html";
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
 * Map language IDs to their local WASM paths
 * TypeScript and JavaScript use the tsx parser
 */
function getLocalWasmPath(languageId: string): string {
  // TypeScript and JavaScript both use tsx parser
  if (languageId === "typescript" || languageId === "javascript") {
    return "/tree-sitter/parsers/tree-sitter-tsx.wasm";
  }
  return `/tree-sitter/parsers/tree-sitter-${languageId}.wasm`;
}

/**
 * Get the query folder for a language ID
 */
function getQueryFolder(languageId: string): string {
  if (languageId === "typescript" || languageId === "javascript") {
    return "tsx";
  }
  return languageId;
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
  const treeCacheActions = useTreeCacheStore.use.actions();

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
          // Use cached config
          wasmPath = cached.sourceUrl || getLocalWasmPath(languageId);
          highlightQuery = cached.highlightQuery;

          // Try to load highlight query if not cached
          if (!highlightQuery || highlightQuery.trim().length === 0) {
            const queryFolder = getQueryFolder(languageId);
            const queryPath = `/tree-sitter/queries/${queryFolder}/highlights.scm`;
            try {
              const response = await fetch(queryPath);
              if (response.ok) {
                highlightQuery = await response.text();
                // Update cache with the loaded query
                await indexedDBParserCache.set({
                  ...cached,
                  highlightQuery,
                });
                logger.info("Editor", `[Tokenizer] Loaded highlight query from ${queryPath}`);
              }
            } catch {
              logger.warn("Editor", `[Tokenizer] Failed to load highlight query from ${queryPath}`);
            }
          }
        } else {
          // Parser not in IndexedDB - try to load from local path
          logger.info(
            "Editor",
            `[Tokenizer] Parser for ${languageId} not in cache, loading from local path`,
          );
          wasmPath = getLocalWasmPath(languageId);

          // Load highlight query from local path
          const queryFolder = getQueryFolder(languageId);
          const queryPath = `/tree-sitter/queries/${queryFolder}/highlights.scm`;
          try {
            const response = await fetch(queryPath);
            if (response.ok) {
              highlightQuery = await response.text();
            }
          } catch {
            logger.warn("Editor", `[Tokenizer] Failed to load highlight query from ${queryPath}`);
          }
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
          // Use cached config
          wasmPath = cached.sourceUrl || getLocalWasmPath(languageId);
          highlightQuery = cached.highlightQuery;

          // Try to load highlight query if not cached
          if (!highlightQuery || highlightQuery.trim().length === 0) {
            const queryFolder = getQueryFolder(languageId);
            const queryPath = `/tree-sitter/queries/${queryFolder}/highlights.scm`;
            try {
              const response = await fetch(queryPath);
              if (response.ok) {
                highlightQuery = await response.text();
                // Update cache with the loaded query
                await indexedDBParserCache.set({
                  ...cached,
                  highlightQuery,
                });
              }
            } catch {
              logger.warn("Editor", `[Tokenizer] Failed to load highlight query from ${queryPath}`);
            }
          }
        } else {
          // Parser not in IndexedDB - try to load from local path
          wasmPath = getLocalWasmPath(languageId);

          // Load highlight query from local path
          const queryFolder = getQueryFolder(languageId);
          const queryPath = `/tree-sitter/queries/${queryFolder}/highlights.scm`;
          try {
            const response = await fetch(queryPath);
            if (response.ok) {
              highlightQuery = await response.text();
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

        const normalizedText = normalizeLineEndings(text);
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

  return { tokens, tokenizedContent, loading, tokenize, forceFullTokenize };
}
