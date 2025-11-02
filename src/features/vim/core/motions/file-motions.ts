/**
 * File-level motions (gg, G)
 */

import type { Position } from "@/features/editor/types/editor";
import { calculateOffsetFromPosition } from "@/features/editor/utils/position";
import type { Motion, MotionCalculateMeta, VimRange } from "../core/types";

const firstNonBlankColumn = (line: string): number => {
  for (let i = 0; i < line.length; i++) {
    if (!/\s/.test(line[i])) {
      return i;
    }
  }
  return 0;
};

const buildRange = (cursor: Position, target: Position): VimRange => {
  return {
    start: cursor,
    end: target,
    inclusive: false,
    linewise: true,
  };
};

/**
 * Motion: gg - go to first line (or count-th line)
 */
export const fileStart: Motion = {
  name: "gg",
  calculate: (
    cursor: Position,
    lines: string[],
    count = 1,
    meta?: MotionCalculateMeta,
  ): VimRange => {
    if (lines.length === 0) {
      return { start: cursor, end: cursor, inclusive: false };
    }

    const hasExplicitCount = meta?.explicitCount ?? false;
    const targetLine = hasExplicitCount
      ? Math.max(0, Math.min(lines.length - 1, count > 0 ? count - 1 : 0))
      : 0;
    const targetColumn = firstNonBlankColumn(lines[targetLine] ?? "");
    const offset = calculateOffsetFromPosition(targetLine, targetColumn, lines);

    const target: Position = {
      line: targetLine,
      column: targetColumn,
      offset,
    };

    return buildRange(cursor, target);
  },
};

/**
 * Motion: G - go to last line (or count-th line)
 */
export const fileEnd: Motion = {
  name: "G",
  calculate: (
    cursor: Position,
    lines: string[],
    count = 1,
    meta?: MotionCalculateMeta,
  ): VimRange => {
    if (lines.length === 0) {
      return { start: cursor, end: cursor, inclusive: false };
    }

    const hasExplicitCount = meta?.explicitCount ?? false;
    const effectiveCount = count > 0 ? count : 1;
    const targetLine = hasExplicitCount
      ? Math.max(0, Math.min(lines.length - 1, effectiveCount - 1))
      : lines.length - 1;

    const targetColumn = firstNonBlankColumn(lines[targetLine] ?? "");
    const offset = calculateOffsetFromPosition(targetLine, targetColumn, lines);

    const target: Position = {
      line: targetLine,
      column: targetColumn,
      offset,
    };

    return buildRange(cursor, target);
  },
};
