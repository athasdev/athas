/**
 * Viewport-based motions (H, M, L)
 */

import { useEditorSettingsStore } from "@/features/editor/stores/settings-store";
import { useEditorStateStore } from "@/features/editor/stores/state-store";
import type { Position } from "@/features/editor/types/editor";
import { calculateOffsetFromPosition, getLineHeight } from "@/features/editor/utils/position";
import type { Motion, VimRange } from "../core/types";

const firstNonBlankColumn = (line: string): number => {
  for (let i = 0; i < line.length; i++) {
    if (!/\s/.test(line[i])) {
      return i;
    }
  }
  return 0;
};

const resolveLineHeight = (): number => {
  const defaultLineHeight = getLineHeight(useEditorSettingsStore.getState().fontSize);

  if (typeof window === "undefined") {
    return defaultLineHeight;
  }

  const textarea = document.querySelector(".editor-textarea") as HTMLTextAreaElement | null;
  if (!textarea) {
    return defaultLineHeight;
  }

  const computedStyle = window.getComputedStyle(textarea);
  const parsedLineHeight = parseFloat(computedStyle.lineHeight);
  if (!Number.isNaN(parsedLineHeight) && parsedLineHeight > 0) {
    return parsedLineHeight;
  }

  const parsedFontSize = parseFloat(computedStyle.fontSize);
  if (!Number.isNaN(parsedFontSize) && parsedFontSize > 0) {
    return getLineHeight(parsedFontSize);
  }

  return defaultLineHeight;
};

const getViewportMetrics = (lines: string[]) => {
  const totalLines = Math.max(lines.length, 1);
  const lineHeight = Math.max(1, resolveLineHeight());

  let scrollTop = 0;
  let viewportHeight = lineHeight * totalLines;

  if (typeof window !== "undefined") {
    const viewport = document.querySelector(".editor-viewport") as HTMLDivElement | null;
    if (viewport) {
      scrollTop = viewport.scrollTop;
      viewportHeight = viewport.clientHeight || viewportHeight;
    }
  }

  const layoutState = useEditorStateStore.getState();
  if (scrollTop === 0 && layoutState.scrollTop) {
    scrollTop = layoutState.scrollTop;
  }
  if ((!viewportHeight || viewportHeight <= 0) && layoutState.viewportHeight) {
    viewportHeight = layoutState.viewportHeight;
  }

  if (!viewportHeight || viewportHeight <= 0) {
    viewportHeight = lineHeight * totalLines;
  }

  const topLine = Math.max(0, Math.min(totalLines - 1, Math.floor(scrollTop / lineHeight)));
  const bottomLine = Math.max(
    topLine,
    Math.min(totalLines - 1, Math.floor((scrollTop + viewportHeight - 1) / lineHeight)),
  );
  const visibleLines = Math.max(1, Math.floor(viewportHeight / lineHeight) || 1);

  return {
    topLine,
    bottomLine,
    visibleLines,
  };
};

const buildRange = (cursor: Position, lines: string[], targetLine: number): VimRange => {
  const clampedLine = Math.max(0, Math.min(lines.length - 1, targetLine));
  const targetColumn = firstNonBlankColumn(lines[clampedLine] ?? "");
  const offset = calculateOffsetFromPosition(clampedLine, targetColumn, lines);

  return {
    start: cursor,
    end: {
      line: clampedLine,
      column: targetColumn,
      offset,
    },
    inclusive: false,
    linewise: true,
  };
};

/**
 * Motion: H - move to top of viewport (count adjusts from top)
 */
export const viewportTop: Motion = {
  name: "H",
  calculate: (cursor: Position, lines: string[], count = 1): VimRange => {
    if (lines.length === 0) {
      return { start: cursor, end: cursor, inclusive: false };
    }

    const { topLine, bottomLine } = getViewportMetrics(lines);
    const effectiveCount = Math.max(1, count);
    const targetLine = Math.min(bottomLine, topLine + effectiveCount - 1);

    return buildRange(cursor, lines, targetLine);
  },
};

/**
 * Motion: M - move to middle of viewport
 */
export const viewportMiddle: Motion = {
  name: "M",
  calculate: (cursor: Position, lines: string[]): VimRange => {
    if (lines.length === 0) {
      return { start: cursor, end: cursor, inclusive: false };
    }

    const { topLine, bottomLine, visibleLines } = getViewportMetrics(lines);
    const middleOffset = Math.floor((visibleLines - 1) / 2);
    const targetLine = Math.max(topLine, Math.min(bottomLine, topLine + middleOffset));

    return buildRange(cursor, lines, targetLine);
  },
};

/**
 * Motion: L - move to bottom of viewport (count adjusts from bottom)
 */
export const viewportBottom: Motion = {
  name: "L",
  calculate: (cursor: Position, lines: string[], count = 1): VimRange => {
    if (lines.length === 0) {
      return { start: cursor, end: cursor, inclusive: false };
    }

    const { topLine, bottomLine } = getViewportMetrics(lines);
    const effectiveCount = Math.max(1, count);
    const targetLine = Math.max(topLine, bottomLine - (effectiveCount - 1));

    return buildRange(cursor, lines, targetLine);
  },
};
