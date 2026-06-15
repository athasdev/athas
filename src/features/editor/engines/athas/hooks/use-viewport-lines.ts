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
  significantLineDiff?: number;
}

const LARGE_FILE_VIEWPORT_THRESHOLD = 20000;
const LARGE_FILE_SIGNIFICANT_LINE_DIFF = 40;

interface CalculateViewportRangeOptions {
  scrollTop: number;
  containerHeight: number;
  totalLines: number;
  lineHeight: number;
  bufferLines: number;
}

export function calculateViewportRangeForScroll({
  scrollTop,
  containerHeight,
  totalLines,
  lineHeight,
  bufferLines,
}: CalculateViewportRangeOptions): ViewportRange {
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
}

function getViewportDiffThreshold({
  totalLines,
  bufferLines,
  significantLineDiff,
}: {
  totalLines: number;
  bufferLines: number;
  significantLineDiff?: number;
}) {
  if (significantLineDiff !== undefined) return significantLineDiff;
  if (bufferLines === 0) return 0;
  return totalLines >= LARGE_FILE_VIEWPORT_THRESHOLD
    ? LARGE_FILE_SIGNIFICANT_LINE_DIFF
    : EDITOR_CONSTANTS.SIGNIFICANT_LINE_DIFF;
}

export function shouldUpdateViewportRange({
  previousRange,
  nextRange,
  bufferLines,
  significantLineDiff,
}: {
  previousRange: ViewportRange;
  nextRange: ViewportRange;
  bufferLines: number;
  significantLineDiff?: number;
}) {
  const startLineDiff = Math.abs(nextRange.startLine - previousRange.startLine);
  const endLineDiff = Math.abs(nextRange.endLine - previousRange.endLine);
  const significantDiffThreshold = getViewportDiffThreshold({
    totalLines: nextRange.totalLines,
    bufferLines,
    significantLineDiff,
  });

  return (
    startLineDiff > significantDiffThreshold ||
    endLineDiff > significantDiffThreshold ||
    nextRange.totalLines !== previousRange.totalLines
  );
}

export function expandViewportRange(
  range: ViewportRange,
  totalLines: number,
  overscanLines: number,
): ViewportRange {
  const safeOverscanLines = Math.max(0, overscanLines);

  return {
    startLine: Math.max(0, range.startLine - safeOverscanLines),
    endLine: Math.min(totalLines, range.endLine + safeOverscanLines),
    totalLines,
  };
}

function areViewportRangesEqual(left: ViewportRange, right: ViewportRange): boolean {
  return (
    left.startLine === right.startLine &&
    left.endLine === right.endLine &&
    left.totalLines === right.totalLines
  );
}

export function useViewportLines(options: UseViewportLinesOptions) {
  const {
    lineHeight,
    bufferLines = EDITOR_CONSTANTS.VIEWPORT_BUFFER_LINES,
    significantLineDiff,
  } = options;

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
      return calculateViewportRangeForScroll({
        scrollTop,
        containerHeight,
        totalLines,
        lineHeight,
        bufferLines,
      });
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
        if (
          shouldUpdateViewportRange({
            previousRange: prev,
            nextRange: newRange,
            bufferLines,
            significantLineDiff,
          })
        ) {
          return newRange;
        }

        return prev;
      });
    },
    [bufferLines, calculateViewportRange, significantLineDiff],
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

      const initialRange = calculateViewportRange(
        containerElement.scrollTop,
        containerHeight,
        totalLines,
      );
      setViewportRange((prev) =>
        areViewportRangesEqual(prev, initialRange) ? prev : initialRange,
      );
    },
    [calculateViewportRange],
  );

  /**
   * Force update viewport (useful after content changes)
   */
  const forceUpdateViewport = useCallback(
    (scrollTop: number, totalLines: number) => {
      const newRange = calculateViewportRange(scrollTop, containerHeightRef.current, totalLines);
      setViewportRange((prev) => (areViewportRangesEqual(prev, newRange) ? prev : newRange));
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
