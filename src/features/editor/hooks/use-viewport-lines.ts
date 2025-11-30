/**
 * Hook for tracking which lines are currently visible in the viewport
 * Used for incremental tokenization to improve performance
 */

import { useCallback, useRef, useState } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";

export interface ViewportRange {
  startLine: number;
  endLine: number;
  totalLines: number;
}

interface UseViewportLinesOptions {
  lineHeight: number;
  bufferLines?: number;
}

export function useViewportLines(options: UseViewportLinesOptions) {
  const { lineHeight, bufferLines = EDITOR_CONSTANTS.VIEWPORT_BUFFER_LINES } = options;

  const [viewportRange, setViewportRange] = useState<ViewportRange>({
    startLine: 0,
    endLine: 100,
    totalLines: 0,
  });

  const containerHeightRef = useRef<number>(0);

  /**
   * Calculate which lines are visible based on scroll position
   */
  const calculateViewportRange = useCallback(
    (scrollTop: number, containerHeight: number, totalLines: number): ViewportRange => {
      // Calculate visible lines
      const startLine = Math.max(0, Math.floor(scrollTop / lineHeight) - bufferLines);
      const visibleLineCount = Math.ceil(containerHeight / lineHeight);
      const endLine = Math.min(
        totalLines,
        Math.floor(scrollTop / lineHeight) + visibleLineCount + bufferLines,
      );

      return {
        startLine,
        endLine,
        totalLines,
      };
    },
    [lineHeight, bufferLines],
  );

  /**
   * Update viewport range based on scroll position
   * Does NOT use RAF - caller should handle batching
   */
  const updateViewportRange = useCallback(
    (scrollTop: number, totalLines: number) => {
      const newRange = calculateViewportRange(scrollTop, containerHeightRef.current, totalLines);

      // Only update if range has changed significantly
      setViewportRange((prev) => {
        const startLineDiff = Math.abs(newRange.startLine - prev.startLine);
        const endLineDiff = Math.abs(newRange.endLine - prev.endLine);

        if (
          startLineDiff > EDITOR_CONSTANTS.SIGNIFICANT_LINE_DIFF ||
          endLineDiff > EDITOR_CONSTANTS.SIGNIFICANT_LINE_DIFF ||
          newRange.totalLines !== prev.totalLines
        ) {
          return newRange;
        }

        return prev;
      });
    },
    [calculateViewportRange],
  );

  /**
   * Handle scroll event from editor
   * Note: This should be called within a RAF callback for best performance
   */
  const handleScroll = useCallback(
    (scrollTop: number, totalLines: number) => {
      updateViewportRange(scrollTop, totalLines);
    },
    [updateViewportRange],
  );

  /**
   * Initialize viewport with container height
   */
  const initializeViewport = useCallback(
    (containerElement: HTMLElement, totalLines: number) => {
      const containerHeight = containerElement.clientHeight;
      containerHeightRef.current = containerHeight;

      const initialRange = calculateViewportRange(0, containerHeight, totalLines);
      setViewportRange(initialRange);
    },
    [calculateViewportRange],
  );

  /**
   * Force update viewport (useful after content changes)
   */
  const forceUpdateViewport = useCallback(
    (scrollTop: number, totalLines: number) => {
      const newRange = calculateViewportRange(scrollTop, containerHeightRef.current, totalLines);
      setViewportRange(newRange);
    },
    [calculateViewportRange],
  );

  /**
   * Check if a line is within the viewport range
   */
  const isLineInViewport = useCallback(
    (lineNumber: number): boolean => {
      return lineNumber >= viewportRange.startLine && lineNumber <= viewportRange.endLine;
    },
    [viewportRange],
  );

  return {
    viewportRange,
    handleScroll,
    initializeViewport,
    forceUpdateViewport,
    isLineInViewport,
  };
}

/**
 * Helper to determine if two viewport ranges overlap significantly
 */
export function hasSignificantOverlap(range1: ViewportRange, range2: ViewportRange): boolean {
  const overlapStart = Math.max(range1.startLine, range2.startLine);
  const overlapEnd = Math.min(range1.endLine, range2.endLine);
  const overlapSize = Math.max(0, overlapEnd - overlapStart);

  const range1Size = range1.endLine - range1.startLine;
  const range2Size = range2.endLine - range2.startLine;
  const minSize = Math.min(range1Size, range2Size);

  // Consider significant if overlap is more than 50% of smaller range
  return overlapSize > minSize * 0.5;
}
