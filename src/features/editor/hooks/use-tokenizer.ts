/**
 * Syntax tokenization hook with support for incremental tokenization
 */

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useRef, useState } from "react";
import type { Token } from "../utils/html";
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

function getExtension(path: string): string {
  const parts = path.split(".");
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

const FULL_TOKENIZE_INTERVAL = 5000; // Re-tokenize full document every 5 seconds
const SMALL_FILE_THRESHOLD = 500; // Lines - always tokenize fully for small files

export function useTokenizer({ filePath, enabled = true, incremental = true }: TokenizerOptions) {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(false);
  const cacheRef = useRef<TokenCache>({ fullTokens: [], lastFullTokenizeTime: 0 });
  const lastViewportRangeRef = useRef<ViewportRange | null>(null);

  /**
   * Tokenize the full document
   */
  const tokenizeFull = useCallback(
    async (text: string) => {
      if (!enabled || !filePath) return;

      const ext = getExtension(filePath);
      if (!ext) return;

      setLoading(true);
      try {
        const result = await invoke<Token[]>("get_tokens", {
          content: text,
          fileExtension: ext,
        });
        setTokens(result);
        cacheRef.current = {
          fullTokens: result,
          lastFullTokenizeTime: Date.now(),
        };
      } catch (error) {
        console.warn("[Tokenizer] Full tokenization failed:", error);
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
  const tokenizeRange = useCallback(
    async (text: string, viewportRange: ViewportRange) => {
      if (!enabled || !filePath) return;

      const ext = getExtension(filePath);
      if (!ext) return;

      const lineCount = text.split("\n").length;

      // For small files, always tokenize fully
      if (lineCount < SMALL_FILE_THRESHOLD) {
        return tokenizeFull(text);
      }

      // Check if we need a full re-tokenize (periodic refresh)
      const timeSinceLastFull = Date.now() - cacheRef.current.lastFullTokenizeTime;
      if (timeSinceLastFull > FULL_TOKENIZE_INTERVAL) {
        return tokenizeFull(text);
      }

      setLoading(true);
      try {
        // Tokenize the viewport range
        const rangeTokens = await invoke<Token[]>("get_tokens_range", {
          content: text,
          fileExtension: ext,
          startLine: viewportRange.startLine,
          endLine: viewportRange.endLine,
        });

        // Merge with cached tokens from outside the viewport
        const { fullTokens } = cacheRef.current;
        const lines = text.split("\n");
        const rangeStartOffset = lines
          .slice(0, viewportRange.startLine)
          .reduce((acc, line) => acc + line.length + 1, 0);
        const rangeEndOffset = lines
          .slice(0, viewportRange.endLine)
          .reduce((acc, line) => acc + line.length + 1, 0);

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

        // Check if viewport changed significantly
        lastViewportRangeRef.current = viewportRange;
      } catch (error) {
        console.warn("[Tokenizer] Range tokenization failed, falling back to full:", error);
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

      return tokenizeRange(text, viewportRange);
    },
    [incremental, tokenizeFull, tokenizeRange],
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
