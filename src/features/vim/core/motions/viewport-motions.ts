/**
 * Viewport-based motions (H, M, L)
 */

import type { Position } from "@/features/editor/types/editor";
import { calculateOffsetFromPosition } from "@/features/editor/utils/position";
import { createDomEditorFacade } from "../dom-editor-facade";
import type { Motion, VimRange } from "../core/types";

const firstNonBlankColumn = (line: string): number => {
  for (let i = 0; i < line.length; i++) {
    if (!/\s/.test(line[i])) {
      return i;
    }
  }
  return 0;
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

    const { topLine, bottomLine } = createDomEditorFacade().getViewportMetrics();
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

    const { topLine, bottomLine, visibleLines } = createDomEditorFacade().getViewportMetrics();
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

    const { topLine, bottomLine } = createDomEditorFacade().getViewportMetrics();
    const effectiveCount = Math.max(1, count);
    const targetLine = Math.max(topLine, bottomLine - (effectiveCount - 1));

    return buildRange(cursor, lines, targetLine);
  },
};
