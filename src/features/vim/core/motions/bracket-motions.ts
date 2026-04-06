import type { Position } from "@/features/editor/types/editor";
import { calculateOffsetFromPosition } from "@/features/editor/utils/position";
import type { Motion, VimRange } from "../core/types";

const BRACKET_PAIRS: Record<string, string> = {
  "(": ")",
  ")": "(",
  "[": "]",
  "]": "[",
  "{": "}",
  "}": "{",
};

const OPEN_BRACKETS = new Set(["(", "[", "{"]);

export const matchBracket: Motion = {
  name: "%",
  calculate: (cursor: Position, lines: string[]): VimRange => {
    const line = lines[cursor.line];
    const charAtCursor = line[cursor.column];

    let startCol = cursor.column;
    let startChar = charAtCursor;

    if (!BRACKET_PAIRS[startChar]) {
      for (let i = cursor.column + 1; i < line.length; i++) {
        if (BRACKET_PAIRS[line[i]]) {
          startCol = i;
          startChar = line[i];
          break;
        }
      }
      if (!BRACKET_PAIRS[startChar]) {
        return { start: cursor, end: cursor, inclusive: true };
      }
    }

    const matchChar = BRACKET_PAIRS[startChar];
    const isOpen = OPEN_BRACKETS.has(startChar);
    let depth = 1;

    if (isOpen) {
      let col = startCol + 1;
      for (let ln = cursor.line; ln < lines.length && depth > 0; ln++) {
        const startC = ln === cursor.line ? col : 0;
        for (let c = startC; c < lines[ln].length && depth > 0; c++) {
          if (lines[ln][c] === startChar) depth++;
          else if (lines[ln][c] === matchChar) depth--;
          if (depth === 0) {
            const offset = calculateOffsetFromPosition(ln, c, lines);
            return {
              start: cursor,
              end: { line: ln, column: c, offset },
              inclusive: true,
            };
          }
        }
        col = 0;
      }
    } else {
      const col = startCol - 1;
      for (let ln = cursor.line; ln >= 0 && depth > 0; ln--) {
        const startC = ln === cursor.line ? col : lines[ln].length - 1;
        for (let c = startC; c >= 0 && depth > 0; c--) {
          if (lines[ln][c] === startChar) depth++;
          else if (lines[ln][c] === matchChar) depth--;
          if (depth === 0) {
            const offset = calculateOffsetFromPosition(ln, c, lines);
            return {
              start: cursor,
              end: { line: ln, column: c, offset },
              inclusive: true,
            };
          }
        }
      }
    }

    return { start: cursor, end: cursor, inclusive: true };
  },
};
