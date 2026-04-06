/**
 * Syntax tokenization hook backed by a dedicated worker.
 * This keeps Tree-sitter parsing and query execution off the UI thread.
 */

import { useCallback, useRef, useState } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { logger } from "@/features/editor/utils/logger";
import { tokenizerWorkerClient } from "../lib/wasm-parser/tokenizer-worker-client";
import type { HighlightToken } from "../lib/wasm-parser/types";
import { buildLineOffsetMap, normalizeLineEndings, type Token } from "../utils/html";
import { getLanguageIdFromPath } from "../utils/language-id";
import { usePerformanceMonitor } from "./use-performance";
import type { ViewportRange } from "./use-viewport-lines";

interface TokenizerOptions {
  filePath: string | undefined;
  bufferId?: string;
  languageIdOverride?: string;
  enabled?: boolean;
  incremental?: boolean;
}

interface TokenCache {
  fullTokens: Token[];
  previousContent: string;
}

interface TextMetricsCache {
  text: string;
  normalizedText: string;
  lineOffsets: number[];
  lineCount: number;
}

export function getLanguageId(filePath: string): string | null {
  return getLanguageIdFromPath(filePath);
}

function convertToToken(highlightToken: HighlightToken): Token {
  return {
    start: highlightToken.startIndex,
    end: highlightToken.endIndex,
    class_name: highlightToken.type,
  };
}

const LARGE_FILE_LINE_THRESHOLD = 20000;
const BACKGROUND_FULL_TOKENIZE_CHAR_THRESHOLD = 200_000;
const BACKGROUND_FULL_TOKENIZE_LINE_THRESHOLD = 4_000;
const BACKGROUND_FULL_TOKENIZE_DELAY_MS = 900;
const BACKGROUND_FULL_TOKENIZE_IDLE_TIMEOUT_MS = 2000;

export function useTokenizer({
  filePath,
  bufferId,
  languageIdOverride,
  enabled = true,
  incremental = true,
}: TokenizerOptions) {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [tokenizedContent, setTokenizedContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const cacheRef = useRef<TokenCache>({
    fullTokens: [],
    previousContent: "",
  });
  const textMetricsRef = useRef<TextMetricsCache | null>(null);
  const requestVersionRef = useRef(0);
  const backgroundSweepVersionRef = useRef(0);
  const backgroundSweepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const tokenizeFull = useCallback(
    async (text: string) => {
      if (!enabled || !filePath || !bufferId) return;

      const languageId = languageIdOverride || getLanguageId(filePath);
      if (!languageId) {
        logger.warn("Editor", `[Tokenizer] No language mapping for ${filePath}`);
        setTokens([]);
        return;
      }

      const requestVersion = ++requestVersionRef.current;
      const normalizedText = normalizeLineEndings(text);

      setLoading(true);
      startMeasure(`tokenizeFull (len: ${normalizedText.length})`);

      try {
        const result = await tokenizerWorkerClient.tokenize({
          bufferId,
          content: normalizedText,
          languageId,
          mode: "full",
        });

        if (requestVersion !== requestVersionRef.current) return;

        const newTokens = result.tokens.map(convertToToken);
        setTokens(newTokens);
        setTokenizedContent(result.normalizedText);
        cacheRef.current = {
          fullTokens: newTokens,
          previousContent: result.normalizedText,
        };
      } catch (error) {
        if (requestVersion !== requestVersionRef.current) return;
        logger.warn("Editor", "[Tokenizer] Full tokenization failed:", error);
        setTokens([]);
        setTokenizedContent("");
      } finally {
        if (requestVersion === requestVersionRef.current) {
          setLoading(false);
        }
        endMeasure(`tokenizeFull (len: ${normalizedText.length})`);
      }
    },
    [enabled, filePath, bufferId, languageIdOverride, startMeasure, endMeasure],
  );

  const tokenizeRangeInternal = useCallback(
    async (text: string, viewportRange: ViewportRange) => {
      if (!enabled || !filePath || !bufferId) return;

      const languageId = languageIdOverride || getLanguageId(filePath);
      if (!languageId) return;

      const requestVersion = ++requestVersionRef.current;
      const { normalizedText, lineOffsets, lineCount } = getTextMetrics(text);
      const shouldScheduleBackgroundFullSweep =
        lineCount <= BACKGROUND_FULL_TOKENIZE_LINE_THRESHOLD &&
        normalizedText.length <= BACKGROUND_FULL_TOKENIZE_CHAR_THRESHOLD;

      setLoading(true);
      startMeasure("tokenizeRangeInternal");

      try {
        const clampedStartLine = Math.max(0, Math.min(viewportRange.startLine, lineCount - 1));
        const clampedEndLine = Math.max(
          clampedStartLine + 1,
          Math.min(viewportRange.endLine, Math.max(lineCount - 1, 0)),
        );

        const result = await tokenizerWorkerClient.tokenize({
          bufferId,
          content: normalizedText,
          languageId,
          mode: "range",
          viewportRange: {
            startLine: clampedStartLine,
            endLine:
              lineCount >= LARGE_FILE_LINE_THRESHOLD
                ? clampedEndLine
                : Math.min(clampedEndLine + EDITOR_CONSTANTS.VIEWPORT_BUFFER_LINES, lineCount - 1),
          },
        });

        if (requestVersion !== requestVersionRef.current) return;

        const rangeTokens = result.tokens.map(convertToToken);
        const rangeStartOffset = lineOffsets[clampedStartLine] || 0;
        const rangeEndLine = Math.min(clampedEndLine + 1, lineOffsets.length - 1);
        const rangeEndOffset =
          rangeEndLine >= 0 && lineOffsets[rangeEndLine] !== undefined
            ? lineOffsets[rangeEndLine]
            : normalizedText.length;

        const cachedTokensOutsideRange = cacheRef.current.fullTokens.filter(
          (token) => token.end <= rangeStartOffset || token.start >= rangeEndOffset,
        );

        const mergedTokens = [...cachedTokensOutsideRange, ...rangeTokens].sort(
          (a, b) => a.start - b.start,
        );

        setTokens(mergedTokens);
        setTokenizedContent(result.normalizedText);
        cacheRef.current.fullTokens = mergedTokens;
        cacheRef.current.previousContent = result.normalizedText;

        if (shouldScheduleBackgroundFullSweep) {
          const sweepVersion = ++backgroundSweepVersionRef.current;
          if (backgroundSweepTimerRef.current !== null) {
            globalThis.clearTimeout(backgroundSweepTimerRef.current);
          }
          backgroundSweepTimerRef.current = globalThis.setTimeout(() => {
            const runFullSweep = () => {
              if (requestVersionRef.current !== requestVersion) return;
              if (backgroundSweepVersionRef.current !== sweepVersion) return;
              void tokenizeFull(result.normalizedText);
            };

            if ("requestIdleCallback" in globalThis) {
              globalThis.requestIdleCallback(runFullSweep, {
                timeout: BACKGROUND_FULL_TOKENIZE_IDLE_TIMEOUT_MS,
              });
            } else {
              runFullSweep();
            }
            backgroundSweepTimerRef.current = null;
          }, BACKGROUND_FULL_TOKENIZE_DELAY_MS);
        }
      } catch (error) {
        if (requestVersion !== requestVersionRef.current) return;
        logger.warn("Editor", "[Tokenizer] Range tokenization failed:", error);
      } finally {
        if (requestVersion === requestVersionRef.current) {
          setLoading(false);
        }
        endMeasure("tokenizeRangeInternal");
      }
    },
    [
      enabled,
      filePath,
      bufferId,
      languageIdOverride,
      getTextMetrics,
      tokenizeFull,
      startMeasure,
      endMeasure,
    ],
  );

  const tokenize = useCallback(
    async (text: string, viewportRange?: ViewportRange) => {
      if (!incremental || !viewportRange) {
        return tokenizeFull(text);
      }

      return tokenizeRangeInternal(text, viewportRange);
    },
    [incremental, tokenizeFull, tokenizeRangeInternal],
  );

  const forceFullTokenize = useCallback(async (text: string) => tokenizeFull(text), [tokenizeFull]);

  const resetForBufferSwitch = useCallback(() => {
    requestVersionRef.current += 1;
    backgroundSweepVersionRef.current += 1;
    if (backgroundSweepTimerRef.current !== null) {
      globalThis.clearTimeout(backgroundSweepTimerRef.current);
      backgroundSweepTimerRef.current = null;
    }
    cacheRef.current = {
      fullTokens: [],
      previousContent: "",
    };
    textMetricsRef.current = null;
    setTokens([]);
    setTokenizedContent("");
    setLoading(false);
  }, []);

  return { tokens, tokenizedContent, loading, tokenize, forceFullTokenize, resetForBufferSwitch };
}
