import { type RefObject, useCallback, useEffect, useRef } from "react";
import { useEditorStateStore } from "../stores/state-store";
import { scrollLogger } from "../utils/scroll-logger";

const SCROLL_STATE_UPDATE_INTERVAL_MS = 33;

interface UseEditorScrollOptions {
  bufferId: string | null;
  viewStateKey: string | null;
  linesCount: number;
  minimapEnabled: boolean;
  switchGuardRef: RefObject<number>;
  highlightRef: RefObject<HTMLDivElement | null>;
  primaryCursorRef: RefObject<HTMLDivElement | null>;
  multiCursorRef: RefObject<HTMLDivElement | null>;
  searchHighlightRef: RefObject<HTMLDivElement | null>;
  selectionLayerRef: RefObject<HTMLDivElement | null>;
  vimCursorRef: RefObject<HTMLDivElement | null>;
  autocompleteCompletionRef: RefObject<HTMLDivElement | null>;
  inlineEditOverlayRef: RefObject<HTMLDivElement | null>;
  gitBlameRef: RefObject<HTMLDivElement | null>;
  inlineDiffRef: RefObject<HTMLDivElement | null>;
  setEditorScrollTop: (top: number) => void;
  handleViewportScroll: (scrollTop: number, totalLines: number) => void;
}

export function useEditorScroll({
  bufferId,
  viewStateKey,
  linesCount,
  minimapEnabled,
  switchGuardRef,
  highlightRef,
  primaryCursorRef,
  multiCursorRef,
  searchHighlightRef,
  selectionLayerRef,
  vimCursorRef,
  autocompleteCompletionRef,
  inlineEditOverlayRef,
  gitBlameRef,
  inlineDiffRef,
  setEditorScrollTop,
  handleViewportScroll,
}: UseEditorScrollOptions) {
  const scrollRafRef = useRef<number | null>(null);
  const lastScrollRef = useRef({ top: 0, left: 0 });
  const isScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastStoreScrollUpdateRef = useRef(0);

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLTextAreaElement>) => {
      const scrollTop = e.currentTarget.scrollTop;
      const scrollLeft = e.currentTarget.scrollLeft;

      if (lastScrollRef.current.top === scrollTop && lastScrollRef.current.left === scrollLeft) {
        return;
      }

      lastScrollRef.current = { top: scrollTop, left: scrollLeft };
      isScrollingRef.current = true;

      const currentBufferId = bufferId;
      const guardAtEntry = switchGuardRef.current;

      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }

      scrollLogger.log(scrollTop, scrollLeft, "editor-scroll");

      if (highlightRef.current) {
        highlightRef.current.style.transform = `translate(-${scrollLeft}px, -${scrollTop}px)`;
      }
      if (primaryCursorRef.current) {
        primaryCursorRef.current.style.transform = `translate(-${scrollLeft}px, -${scrollTop}px)`;
      }
      if (multiCursorRef.current) {
        multiCursorRef.current.style.transform = `translate(-${scrollLeft}px, -${scrollTop}px)`;
      }
      if (searchHighlightRef.current) {
        searchHighlightRef.current.style.transform = `translate(-${scrollLeft}px, -${scrollTop}px)`;
      }
      if (selectionLayerRef.current) {
        selectionLayerRef.current.style.transform = `translate(-${scrollLeft}px, -${scrollTop}px)`;
      }
      if (vimCursorRef.current) {
        vimCursorRef.current.style.transform = `translate(-${scrollLeft}px, -${scrollTop}px)`;
      }
      if (autocompleteCompletionRef.current) {
        autocompleteCompletionRef.current.style.transform = `translate(-${scrollLeft}px, -${scrollTop}px)`;
      }
      if (inlineEditOverlayRef.current) {
        inlineEditOverlayRef.current.style.transform = `translate(-${scrollLeft}px, -${scrollTop}px)`;
      }
      if (gitBlameRef.current) {
        gitBlameRef.current.style.transform = `translate(-${scrollLeft}px, -${scrollTop}px)`;
      }
      if (inlineDiffRef.current) {
        inlineDiffRef.current.style.transform = `translate(-${scrollLeft}px, -${scrollTop}px)`;
      }

      if (scrollRafRef.current === null) {
        scrollRafRef.current = requestAnimationFrame(() => {
          // Bail if a buffer switch happened since this RAF was queued
          if (switchGuardRef.current !== guardAtEntry) {
            scrollRafRef.current = null;
            return;
          }

          const { top, left } = lastScrollRef.current;

          if (minimapEnabled) {
            setEditorScrollTop(top);
          }

          const now = performance.now();
          if (now - lastStoreScrollUpdateRef.current >= SCROLL_STATE_UPDATE_INTERVAL_MS) {
            useEditorStateStore
              .getState()
              .actions.setScrollForBuffer(viewStateKey ?? currentBufferId, top, left);
            lastStoreScrollUpdateRef.current = now;
          }

          handleViewportScroll(top, linesCount);

          scrollRafRef.current = null;
        });
      }

      scrollTimeoutRef.current = setTimeout(() => {
        isScrollingRef.current = false;
        const { top, left } = lastScrollRef.current;
        useEditorStateStore
          .getState()
          .actions.setScrollForBuffer(viewStateKey ?? currentBufferId, top, left);
        lastStoreScrollUpdateRef.current = performance.now();
      }, 150);
    },
    [
      bufferId,
      viewStateKey,
      handleViewportScroll,
      linesCount,
      minimapEnabled,
      switchGuardRef,
      highlightRef,
      primaryCursorRef,
      multiCursorRef,
      searchHighlightRef,
      selectionLayerRef,
      vimCursorRef,
      autocompleteCompletionRef,
      inlineEditOverlayRef,
      gitBlameRef,
      inlineDiffRef,
      setEditorScrollTop,
    ],
  );

  // Cleanup scroll RAF and timeout on unmount
  useEffect(() => {
    return () => {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
      }
      if (scrollTimeoutRef.current !== null) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  return { handleScroll, isScrollingRef, lastScrollRef };
}
