/**
 * Line-based motions (0, $, ^, etc.)
 *
 * These motions handle movement within lines:
 * - 0: Move to column 0 (beginning of line)
 * - ^: Move to first non-blank character
 * - $: Move to end of line (last character)
 * - _: Move to first non-blank character (with count support)
 */

import type { Position } from "@/types/editor-types";
import { calculateOffsetFromPosition } from "@/utils/editor-position";
import type { Motion, VimRange } from "../core/types";

/**
 * Motion: 0 - start of line (column 0)
 */
export const lineStart: Motion = {
  name: "0",
  calculate: (cursor: Position, lines: string[]): VimRange => {
    const column = 0;
    const offset = calculateOffsetFromPosition(cursor.line, column, lines);

    return {
      start: cursor,
      end: {
        line: cursor.line,
        column,
        offset,
      },
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

    // If line is all whitespace, stay at column 0
    if (column >= line.length) {
      column = 0;
    }

    const offset = calculateOffsetFromPosition(cursor.line, column, lines);

    return {
      start: cursor,
      end: {
        line: cursor.line,
        column,
        offset,
      },
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
    const line = lines[targetLine];

    // In Vim, $ positions cursor:
    // - For empty lines: at column 0
    // - For non-empty lines: on the last character (not beyond it)
    let column: number;
    if (line.length === 0) {
      column = 0;
    } else {
      column = line.length - 1;
    }

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
 * Motion: _ - first non-blank character of line (like ^, but with count support)
 */
export const lineFirstNonBlankUnderscore: Motion = {
  name: "_",
  calculate: (cursor: Position, lines: string[], count = 1): VimRange => {
    // _ can take a count - goes to first non-blank of (current line + count - 1)
    const targetLine = Math.min(cursor.line + count - 1, lines.length - 1);
    const line = lines[targetLine];
    let column = 0;

    // Find first non-whitespace character
    while (column < line.length && /\s/.test(line[column])) {
      column++;
    }

    // If line is all whitespace, stay at column 0
    if (column >= line.length) {
      column = 0;
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
