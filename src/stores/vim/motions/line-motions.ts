/**
 * Line-based motions (0, $, ^, etc.)
 */

import type { Position } from "@/types/editor-types";
import { calculateOffsetFromPosition } from "@/utils/editor-position";
import type { Motion, VimRange } from "../core/types";

/**
 * Motion: 0 - start of line
 */
export const lineStart: Motion = {
  name: "0",
  calculate: (cursor: Position, lines: string[]): VimRange => {
    const column = 0;
    const offset = calculateOffsetFromPosition(cursor.line, column, lines);

    return {
      start: {
        line: cursor.line,
        column,
        offset,
      },
      end: cursor,
      inclusive: false,
    };
  },
};

/**
 * Motion: ^ - first non-blank character of line
 */
export const lineFirstNonBlank: Motion = {
  name: "^",
  calculate: (cursor: Position, lines: string[]): VimRange => {
    const line = lines[cursor.line];
    let column = 0;

    // Find first non-whitespace character
    while (column < line.length && /\s/.test(line[column])) {
      column++;
    }

    const offset = calculateOffsetFromPosition(cursor.line, column, lines);

    return {
      start: {
        line: cursor.line,
        column,
        offset,
      },
      end: cursor,
      inclusive: false,
    };
  },
};

/**
 * Motion: $ - end of line
 */
export const lineEnd: Motion = {
  name: "$",
  calculate: (cursor: Position, lines: string[], count = 1): VimRange => {
    // $ can take a count - goes to end of (current line + count - 1)
    const targetLine = Math.min(cursor.line + count - 1, lines.length - 1);
    const column = lines[targetLine].length;
    const offset = calculateOffsetFromPosition(targetLine, column, lines);

    return {
      start: cursor,
      end: {
        line: targetLine,
        column,
        offset,
      },
      inclusive: true,
    };
  },
};

/**
 * Motion: _ - first non-blank character of line (like ^)
 */
export const lineFirstNonBlankUnderscore: Motion = {
  name: "_",
  calculate: (cursor: Position, lines: string[], count = 1): VimRange => {
    // _ can take a count - goes to first non-blank of (current line + count - 1)
    const targetLine = Math.min(cursor.line + count - 1, lines.length - 1);
    const line = lines[targetLine];
    let column = 0;

    while (column < line.length && /\s/.test(line[column])) {
      column++;
    }

    const offset = calculateOffsetFromPosition(targetLine, column, lines);

    return {
      start: cursor,
      end: {
        line: targetLine,
        column,
        offset,
      },
      inclusive: false,
    };
  },
};
