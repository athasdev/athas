import { type RefObject, useEffect, useRef } from "react";
import { useEditorUIStore } from "../stores/ui-store";
import { normalizeLineEndings } from "../utils/html";
import type { ViewportRange } from "./use-viewport-lines";

const LARGE_FILE_SCROLL_OPTIMIZATION_THRESHOLD = 20_000;
const LARGE_FILE_SCROLL_TOKENIZE_THROTTLE_MS = 48;
const TOKENIZE_AFTER_TYPING_DEBOUNCE_MS = 260;
const INACTIVE_SURFACE_TOKENIZE_DELAY_MS = 120;

interface UseTokenizationSchedulerOptions {
  bufferId: string | null;
  filePath?: string;
  content?: string;
  enabled: boolean;
  tokenizedContent: string;
  tokenCount: number;
  visualLineCount: number;
  incremental: boolean;
  viewportRange?: ViewportRange;
  isScrollingRef: RefObject<boolean>;
  isActiveSurface: boolean;
  tokenize: (text: string, viewportRange?: ViewportRange) => Promise<void>;
}

export function useTokenizationScheduler({
  bufferId,
  filePath,
  content,
  enabled,
  tokenizedContent,
  tokenCount,
  visualLineCount,
  incremental,
  viewportRange,
  isScrollingRef,
  isActiveSurface,
  tokenize,
}: UseTokenizationSchedulerOptions) {
  const tokenizeRafRef = useRef<number | null>(null);
  const tokenizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastLargeFileScrollTokenizeAtRef = useRef(0);

  useEffect(() => {
    if (!enabled || !content || !filePath) return;

    if (tokenizeRafRef.current !== null) {
      cancelAnimationFrame(tokenizeRafRef.current);
    }
    if (tokenizeTimeoutRef.current !== null) {
      clearTimeout(tokenizeTimeoutRef.current);
    }

    const targetViewportRange = incremental ? viewportRange : undefined;
    const isLargeFile = visualLineCount >= LARGE_FILE_SCROLL_OPTIMIZATION_THRESHOLD;
    const latestInputTimestamp = useEditorUIStore.getState().lastInputTimestamp;
    const msSinceInput = latestInputTimestamp > 0 ? Date.now() - latestInputTimestamp : Infinity;
    const isTypingUpdate = msSinceInput < TOKENIZE_AFTER_TYPING_DEBOUNCE_MS;

    if (!incremental && tokenCount > 0 && tokenizedContent === normalizeLineEndings(content)) {
      return;
    }

    const scheduleTimeout = (delayMs: number, onBeforeTokenize?: () => void) => {
      tokenizeTimeoutRef.current = setTimeout(() => {
        onBeforeTokenize?.();
        void tokenize(content, targetViewportRange);
        tokenizeTimeoutRef.current = null;
      }, delayMs);

      return () => {
        if (tokenizeTimeoutRef.current !== null) {
          clearTimeout(tokenizeTimeoutRef.current);
        }
      };
    };

    if (incremental && isLargeFile && isScrollingRef.current) {
      const now = Date.now();
      const elapsedSinceScrollTokenize = now - lastLargeFileScrollTokenizeAtRef.current;

      if (elapsedSinceScrollTokenize >= LARGE_FILE_SCROLL_TOKENIZE_THROTTLE_MS) {
        lastLargeFileScrollTokenizeAtRef.current = now;
        void tokenize(content, targetViewportRange);
        return;
      }

      return scheduleTimeout(
        LARGE_FILE_SCROLL_TOKENIZE_THROTTLE_MS - elapsedSinceScrollTokenize,
        () => {
          lastLargeFileScrollTokenizeAtRef.current = Date.now();
        },
      );
    }

    if (isTypingUpdate) {
      return scheduleTimeout(TOKENIZE_AFTER_TYPING_DEBOUNCE_MS);
    }

    if (!isActiveSurface) {
      return scheduleTimeout(INACTIVE_SURFACE_TOKENIZE_DELAY_MS);
    }

    tokenizeRafRef.current = requestAnimationFrame(() => {
      void tokenize(content, targetViewportRange);
      tokenizeRafRef.current = null;
    });

    return () => {
      if (tokenizeRafRef.current !== null) {
        cancelAnimationFrame(tokenizeRafRef.current);
      }
      if (tokenizeTimeoutRef.current !== null) {
        clearTimeout(tokenizeTimeoutRef.current);
      }
    };
  }, [
    bufferId,
    content,
    enabled,
    filePath,
    incremental,
    isActiveSurface,
    isScrollingRef,
    tokenize,
    tokenizedContent,
    tokenCount,
    viewportRange?.startLine,
    viewportRange?.endLine,
    visualLineCount,
  ]);
}
