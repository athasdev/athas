import { type RefObject, useCallback, useEffect, useRef } from "react";
import { useEditorStateStore } from "../stores/state-store";
import { applyEditorScrollTransform, type ScrollLayerRef } from "../utils/scroll-layers";
import { scrollLogger } from "../utils/scroll-logger";

const SCROLL_STATE_UPDATE_INTERVAL_MS = 33;

interface UseEditorScrollOptions {
  bufferId: string | null;
  viewStateKey: string | null;
  linesCount: number;
  minimapEnabled: boolean;
  lockVerticalScroll?: boolean;
  switchGuardRef: RefObject<number>;
  scrollLayerRefs: readonly ScrollLayerRef[];
  setEditorScrollTop: (top: number) => void;
  handleViewportScroll: (scrollTop: number, totalLines: number) => void;
}

export function useEditorScroll({
  bufferId,
  viewStateKey,
  linesCount,
  minimapEnabled,
  lockVerticalScroll = false,
  switchGuardRef,
  scrollLayerRefs,
  setEditorScrollTop,
  handleViewportScroll,
}: UseEditorScrollOptions) {
  const scrollRafRef = useRef<number | null>(null);
  const lastScrollRef = useRef({ top: 0, left: 0 });
  const isScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastStoreScrollUpdateRef = useRef(0);

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLElement>) => {
      if (lockVerticalScroll && e.currentTarget.scrollTop !== 0) {
        e.currentTarget.scrollTop = 0;
      }

      const scrollTop = lockVerticalScroll ? 0 : e.currentTarget.scrollTop;
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
      applyEditorScrollTransform(scrollLayerRefs, scrollLeft, scrollTop);

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
      lockVerticalScroll,
      switchGuardRef,
      scrollLayerRefs,
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
