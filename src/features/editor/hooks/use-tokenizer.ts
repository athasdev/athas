/**
 * Syntax tokenization hook with support for incremental tokenization
 * Uses WASM Tree-sitter parsers loaded from IndexedDB
 */

import { useCallback, useRef, useState } from "react";
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
   * Check if parser is available for the language
   */
  const isParserAvailable = useCallback(async (languageId: string): Promise<boolean> => {
    try {
      return await indexedDBParserCache.has(languageId);
    } catch {
      return false;
    }
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

      // Check if parser is available in IndexedDB
      const available = await isParserAvailable(languageId);
      if (!available) {
        logger.warn("Editor", `[Tokenizer] Parser for ${languageId} not installed`);
        setTokens([]);
        return;
      }

      setLoading(true);
      try {
        // Get parser config from IndexedDB cache
        const cached = await indexedDBParserCache.get(languageId);
        if (!cached) {
          throw new Error(`Parser ${languageId} not found in cache`);
        }

        // Normalize line endings before tokenizing to match HighlightLayer normalization
        const normalizedText = normalizeLineEndings(text);

        // Load and tokenize using WASM
        const highlightTokens = await tokenizeCode(normalizedText, languageId, {
          languageId,
          wasmPath: cached.sourceUrl || "",
          highlightQuery: cached.highlightQuery,
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
    [enabled, filePath, isParserAvailable],
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

      // Check if parser is available
      const available = await isParserAvailable(languageId);
      if (!available) {
        logger.warn("Editor", `[Tokenizer] Parser for ${languageId} not installed`);
        setTokens([]);
        return;
      }

      setLoading(true);
      try {
        // Get parser config from IndexedDB cache
        const cached = await indexedDBParserCache.get(languageId);
        if (!cached) {
          throw new Error(`Parser ${languageId} not found in cache`);
        }

        // Tokenize the viewport range
        const highlightTokens = await wasmTokenizeRange(
          text,
          languageId,
          viewportRange.startLine,
          viewportRange.endLine,
          {
            languageId,
            wasmPath: cached.sourceUrl || "",
            highlightQuery: cached.highlightQuery,
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
    [enabled, filePath, tokenizeFull, isParserAvailable],
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
