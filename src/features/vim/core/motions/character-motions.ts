/**
 * Character-based motions (h, l, f, F, t, T, ;, ,)
 */

import type { Position } from "@/features/editor/types/editor";
import { calculateOffsetFromPosition } from "@/features/editor/utils/position";
import type { Motion, VimRange } from "../core/types";

/**
 * Last find character motion for ; and , commands
 */
let lastFindChar: string | null = null;
let lastFindDirection: "forward" | "backward" = "forward";
let lastFindType: "to" | "find" = "find";

/**
 * Motion: h - left
 */
export const charLeft: Motion = {
  name: "h",
  calculate: (cursor: Position, lines: string[], count = 1): VimRange => {
    const newColumn = Math.max(0, cursor.column - count);
    const newLine = cursor.line;

    const offset = calculateOffsetFromPosition(newLine, newColumn, lines);

    return {
      start: cursor,
      end: {
        line: newLine,
        column: newColumn,
        offset,
      },
      inclusive: false,
    };
  },
};

/**
 * Motion: l - right
 */
export const charRight: Motion = {
  name: "l",
  calculate: (cursor: Position, lines: string[], count = 1): VimRange => {
    const lineLength = lines[cursor.line].length;
    // vim's l stops at the last character, not past it
    const newColumn = Math.min(Math.max(0, lineLength - 1), cursor.column + count);

    const offset = calculateOffsetFromPosition(cursor.line, newColumn, lines);

    return {
      start: cursor,
      end: {
        line: cursor.line,
        column: newColumn,
        offset,
      },
      inclusive: false,
    };
  },
};

/**
 * Motion: j - down
 */
export const charDown: Motion = {
  name: "j",
  calculate: (cursor: Position, lines: string[], count = 1): VimRange => {
    const newLine = Math.min(lines.length - 1, cursor.line + count);
    const newColumn = Math.min(cursor.column, lines[newLine].length);
    const offset = calculateOffsetFromPosition(newLine, newColumn, lines);

    return {
      start: cursor,
      end: {
        line: newLine,
        column: newColumn,
        offset,
      },
      inclusive: false,
      linewise: count > 1, // Multi-line j is linewise
    };
  },
};

/**
 * Motion: k - up
 */
export const charUp: Motion = {
  name: "k",
  calculate: (cursor: Position, lines: string[], count = 1): VimRange => {
    const newLine = Math.max(0, cursor.line - count);
    const newColumn = Math.min(cursor.column, lines[newLine]?.length || 0);
    const offset = calculateOffsetFromPosition(newLine, newColumn, lines);

    return {
      start: cursor,
      end: {
        line: newLine,
        column: newColumn,
        offset,
      },
      inclusive: false,
      linewise: count > 1, // Multi-line k is linewise
    };
  },
};

/**
 * Build a find character motion without mutating global repeat state.
 * Used by repeat commands (; ,) so they don't corrupt the stored direction.
 */
const buildFindCharMotion = (
  char: string,
  direction: "forward" | "backward",
  type: "find" | "to",
): Motion => ({
  name: `${type}-${direction}-${char}`,
  calculate: (cursor: Position, lines: string[], count = 1): VimRange => {
    const line = lines[cursor.line];
    let column = cursor.column;
    let foundCount = 0;

    if (direction === "forward") {
      // Search forward
      for (let i = column + 1; i < line.length; i++) {
        if (line[i] === char) {
          foundCount++;
          if (foundCount === count) {
            column = type === "to" ? i - 1 : i;
            break;
          }
        }
      }
    } else {
      // Search backward
      for (let i = column - 1; i >= 0; i--) {
        if (line[i] === char) {
          foundCount++;
          if (foundCount === count) {
            column = type === "to" ? i + 1 : i;
            break;
          }
        }
      }
    }

    const offset = calculateOffsetFromPosition(cursor.line, column, lines);

    return {
      start: cursor,
      end: {
        line: cursor.line,
        column,
        offset,
      },
      inclusive: true,
    };
  },
});

/**
 * Create a find character motion and store it for repeat (; ,)
 */
export const createFindCharMotion = (
  char: string,
  direction: "forward" | "backward",
  type: "find" | "to",
): Motion => {
  // Store for repeat (;, ,)
  lastFindChar = char;
  lastFindDirection = direction;
  lastFindType = type;

  return buildFindCharMotion(char, direction, type);
};

/**
 * Motion: ; - repeat last f/F/t/T
 */
export const repeatFindChar: Motion = {
  name: ";",
  calculate: (cursor: Position, lines: string[], count = 1): VimRange => {
    if (!lastFindChar) {
      return { start: cursor, end: cursor, inclusive: false };
    }

    // Use buildFindCharMotion to avoid mutating global state
    const motion = buildFindCharMotion(lastFindChar, lastFindDirection, lastFindType);
    return motion.calculate(cursor, lines, count);
  },
};

/**
 * Motion: , - repeat last f/F/t/T in opposite direction
 */
export const repeatFindCharReverse: Motion = {
  name: ",",
  calculate: (cursor: Position, lines: string[], count = 1): VimRange => {
    if (!lastFindChar) {
      return { start: cursor, end: cursor, inclusive: false };
    }

    const oppositeDirection = lastFindDirection === "forward" ? "backward" : "forward";
    // Use buildFindCharMotion to avoid mutating global state
    const motion = buildFindCharMotion(lastFindChar, oppositeDirection, lastFindType);
    return motion.calculate(cursor, lines, count);
  },
};

/**
 * Reset find character state (useful when switching files)
 */
export const resetFindChar = () => {
  lastFindChar = null;
};
