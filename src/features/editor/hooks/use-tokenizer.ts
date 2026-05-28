/**
 * Syntax tokenization hook backed by a dedicated worker.
 * This keeps Tree-sitter parsing and query execution off the UI thread for non-Monaco surfaces.
 */

import { useCallback, useRef, useState } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { logger } from "@/features/editor/utils/logger";
import { getLanguageAssetConfig } from "../lib/wasm-parser/extension-assets";
import { tokenizerWorkerClient } from "../lib/wasm-parser/tokenizer-worker-client";
import type { HighlightToken } from "../lib/wasm-parser/types";
import { buildLineOffsetMap, normalizeLineEndings, type Token } from "../utils/html";
import { getLanguageIdFromPath } from "../utils/language-id";
import { hasLineBasedSyntaxHighlighter, tokenizeLineBasedSyntax } from "../utils/line-based-syntax";
import { calculateEdit, isSimpleEdit } from "../utils/tree-sitter-edit";
import { usePerformanceMonitor } from "./use-performance";

export interface ViewportRange {
  startLine: number;
  endLine: number;
  totalLines: number;
}

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

interface TokenState {
  bufferId?: string;
  tokens: Token[];
}

export interface SyntaxTokenSnapshot {
  bufferId: string;
  content: string;
  tokens: Token[];
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
const LARGE_FILE_RANGE_TOKENIZATION_BUFFER_LINES = 160;
const BACKGROUND_FULL_TOKENIZE_CHAR_THRESHOLD = 200_000;
const BACKGROUND_FULL_TOKENIZE_LINE_THRESHOLD = 4_000;
const BACKGROUND_FULL_TOKENIZE_DELAY_MS = 900;
const BACKGROUND_FULL_TOKENIZE_IDLE_TIMEOUT_MS = 2000;

export function retargetTokensForContentEdit(
  tokens: Token[],
  oldContent: string,
  newContent: string,
): Token[] {
  if (tokens.length === 0 || oldContent === newContent) {
    return tokens;
  }

  if (!isSimpleEdit(oldContent, newContent)) {
    return [];
  }

  const edit = calculateEdit(oldContent, newContent);
  if (!edit) {
    return tokens;
  }

  const delta = edit.newEndIndex - edit.oldEndIndex;
  const nextTokens: Token[] = [];

  for (const token of tokens) {
    if (token.end <= edit.startIndex) {
      nextTokens.push(token);
      continue;
    }

    if (token.start >= edit.oldEndIndex) {
      nextTokens.push({
        ...token,
        start: token.start + delta,
        end: token.end + delta,
      });
      continue;
    }

    const startsBeforeEdit = token.start < edit.startIndex;
    const endsAfterEdit = token.end > edit.oldEndIndex;

    if (startsBeforeEdit && endsAfterEdit) {
      nextTokens.push({
        ...token,
        end: token.end + delta,
      });
      continue;
    }

    if (startsBeforeEdit && token.end > edit.startIndex) {
      nextTokens.push({
        ...token,
        end: edit.startIndex,
      });
      continue;
    }

    if (endsAfterEdit && token.start < edit.oldEndIndex) {
      nextTokens.push({
        ...token,
        start: edit.newEndIndex,
        end: token.end + delta,
      });
    }
  }

  return nextTokens.filter(
    (token) => token.start < token.end && token.start >= 0 && token.end <= newContent.length,
  );
}

export function resolveSyntaxTokensForContent({
  tokens,
  tokenizedContent,
  normalizedContent,
  bufferId,
  snapshot,
}: {
  tokens: Token[];
  tokenizedContent: string;
  normalizedContent: string;
  bufferId?: string;
  snapshot?: SyntaxTokenSnapshot | null;
}): Token[] {
  let sourceTokens = tokens;
  let sourceContent = tokenizedContent;

  if (sourceTokens.length === 0 && bufferId && snapshot?.bufferId === bufferId) {
    sourceTokens = snapshot.tokens;
    sourceContent = snapshot.content;
  }

  if (sourceTokens.length === 0) return [];
  if (sourceContent === normalizedContent) return sourceTokens;
  if (!sourceContent) return sourceTokens;

  const retargetedTokens = retargetTokensForContentEdit(
    sourceTokens,
    sourceContent,
    normalizedContent,
  );

  return retargetedTokens.length > 0 ? retargetedTokens : sourceTokens;
}

export function expandTokenizationViewportRange(
  viewportRange: ViewportRange,
  lineCount: number,
): ViewportRange {
  const lastLine = Math.max(lineCount - 1, 0);
  const startLine = Math.max(0, Math.min(viewportRange.startLine, lastLine));
  const endLine = Math.max(startLine, Math.min(viewportRange.endLine, lastLine));
  const bufferLines =
    lineCount >= LARGE_FILE_LINE_THRESHOLD
      ? LARGE_FILE_RANGE_TOKENIZATION_BUFFER_LINES
      : EDITOR_CONSTANTS.VIEWPORT_BUFFER_LINES;

  return {
    startLine: Math.max(0, startLine - bufferLines),
    endLine: Math.min(lastLine, endLine + bufferLines),
    totalLines: lineCount,
  };
}

export function mergeTokenizedRange({
  cachedTokens,
  rangeTokens,
  rangeStartOffset,
  rangeEndOffset,
  retainOutsideRange,
}: {
  cachedTokens: Token[];
  rangeTokens: Token[];
  rangeStartOffset: number;
  rangeEndOffset: number;
  retainOutsideRange: boolean;
}): Token[] {
  if (!retainOutsideRange) {
    return [...rangeTokens].sort((a, b) => a.start - b.start);
  }

  const cachedTokensOutsideRange = cachedTokens.filter(
    (token) => token.end <= rangeStartOffset || token.start >= rangeEndOffset,
  );

  return [...cachedTokensOutsideRange, ...rangeTokens].sort((a, b) => a.start - b.start);
}

export function useTokenizer({
  filePath,
  bufferId,
  languageIdOverride,
  enabled = true,
  incremental = true,
}: TokenizerOptions) {
  const [tokenState, setTokenState] = useState<TokenState>({ tokens: [] });
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
  const tokens = tokenState.bufferId === bufferId ? tokenState.tokens : [];

  const retargetCachedTokens = useCallback(
    (normalizedText: string) => {
      if (!bufferId) return;

      const cached = cacheRef.current;
      const retargetedTokens = retargetTokensForContentEdit(
        cached.fullTokens,
        cached.previousContent,
        normalizedText,
      );

      if (retargetedTokens === cached.fullTokens) {
        return;
      }

      cacheRef.current = {
        fullTokens: retargetedTokens,
        previousContent: normalizedText,
      };
      setTokenState({ bufferId, tokens: retargetedTokens });
      setTokenizedContent(normalizedText);
    },
    [bufferId],
  );

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
        setTokenState({ bufferId, tokens: [] });
        return;
      }

      const requestVersion = ++requestVersionRef.current;
      const normalizedText = normalizeLineEndings(text);

      if (hasLineBasedSyntaxHighlighter(languageId)) {
        const newTokens = tokenizeLineBasedSyntax(normalizedText, languageId);
        setTokenState({ bufferId, tokens: newTokens });
        setTokenizedContent(normalizedText);
        cacheRef.current = {
          fullTokens: newTokens,
          previousContent: normalizedText,
        };
        return;
      }

      const languageAssets = getLanguageAssetConfig(languageId);

      retargetCachedTokens(normalizedText);
      setLoading(true);
      startMeasure(`tokenizeFull (len: ${normalizedText.length})`);

      try {
        const result = await tokenizerWorkerClient.tokenize({
          bufferId,
          content: normalizedText,
          languageId,
          wasmPath: languageAssets.wasmPath,
          highlightQueryUrl: languageAssets.highlightQueryUrl,
          mode: "full",
        });

        if (requestVersion !== requestVersionRef.current) return;

        const newTokens = result.tokens.map(convertToToken);
        setTokenState({ bufferId, tokens: newTokens });
        setTokenizedContent(result.normalizedText);
        cacheRef.current = {
          fullTokens: newTokens,
          previousContent: result.normalizedText,
        };
      } catch (error) {
        if (requestVersion !== requestVersionRef.current) return;
        logger.warn("Editor", "[Tokenizer] Full tokenization failed:", error);
        setTokenState({ bufferId, tokens: [] });
        setTokenizedContent("");
      } finally {
        if (requestVersion === requestVersionRef.current) {
          setLoading(false);
        }
        endMeasure(`tokenizeFull (len: ${normalizedText.length})`);
      }
    },
    [
      enabled,
      filePath,
      bufferId,
      languageIdOverride,
      retargetCachedTokens,
      startMeasure,
      endMeasure,
    ],
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

      retargetCachedTokens(normalizedText);
      setLoading(true);
      startMeasure("tokenizeRangeInternal");

      try {
        const tokenizationRange = expandTokenizationViewportRange(viewportRange, lineCount);

        if (hasLineBasedSyntaxHighlighter(languageId)) {
          const rangeTokens = tokenizeLineBasedSyntax(normalizedText, languageId, {
            startLine: tokenizationRange.startLine,
            endLine: tokenizationRange.endLine,
          });
          const rangeStartOffset = lineOffsets[tokenizationRange.startLine] ?? 0;
          const rangeEndOffset =
            lineOffsets[tokenizationRange.endLine + 1] ?? normalizedText.length;
          const mergedTokens = mergeTokenizedRange({
            cachedTokens: cacheRef.current.fullTokens,
            rangeTokens,
            rangeStartOffset,
            rangeEndOffset,
            retainOutsideRange: lineCount < LARGE_FILE_LINE_THRESHOLD,
          });

          setTokenState({ bufferId, tokens: mergedTokens });
          setTokenizedContent(normalizedText);
          cacheRef.current.fullTokens = mergedTokens;
          cacheRef.current.previousContent = normalizedText;
          return;
        }

        const languageAssets = getLanguageAssetConfig(languageId);

        const result = await tokenizerWorkerClient.tokenize({
          bufferId,
          content: normalizedText,
          languageId,
          wasmPath: languageAssets.wasmPath,
          highlightQueryUrl: languageAssets.highlightQueryUrl,
          mode: "range",
          viewportRange: {
            startLine: tokenizationRange.startLine,
            endLine: tokenizationRange.endLine,
          },
        });

        if (requestVersion !== requestVersionRef.current) return;

        const rangeTokens = result.tokens.map(convertToToken);
        const rangeStartOffset = lineOffsets[tokenizationRange.startLine] ?? 0;
        const rangeEndOffset = lineOffsets[tokenizationRange.endLine + 1] ?? normalizedText.length;
        const mergedTokens = mergeTokenizedRange({
          cachedTokens: cacheRef.current.fullTokens,
          rangeTokens,
          rangeStartOffset,
          rangeEndOffset,
          retainOutsideRange: lineCount < LARGE_FILE_LINE_THRESHOLD,
        });

        setTokenState({ bufferId, tokens: mergedTokens });
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
      retargetCachedTokens,
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
    setTokenState({ tokens: [] });
    setTokenizedContent("");
    setLoading(false);
  }, []);

  return { tokens, tokenizedContent, loading, tokenize, forceFullTokenize, resetForBufferSwitch };
}
