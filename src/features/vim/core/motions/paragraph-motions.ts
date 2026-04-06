/**
 * Paragraph motions ({ and })
 *
 * These motions move the cursor to blank line boundaries:
 * - }: Move forward to the next blank line (or end of file)
 * - {: Move backward to the previous blank line (or start of file)
 */

import type { Position } from "@/features/editor/types/editor";
import { calculateOffsetFromPosition } from "@/features/editor/utils/position";
import type { Motion, VimRange } from "../core/types";

/**
 * Motion: } - move forward to next blank line (paragraph boundary)
 */
export const paragraphForward: Motion = {
  name: "}",
  linewise: true,
  calculate: (cursor: Position, lines: string[], count = 1): VimRange => {
    let line = cursor.line;

    for (let c = 0; c < count; c++) {
      // If currently on a blank line, skip past consecutive blank lines
      while (line < lines.length - 1 && lines[line].trim() === "") {
        line++;
      }
      // Now skip past non-blank lines (the paragraph body)
      while (line < lines.length - 1 && lines[line].trim() !== "") {
        line++;
      }
      // We're now on a blank line or at the last line
    }

    const column = 0;
    const offset = calculateOffsetFromPosition(line, column, lines);

    return {
      start: cursor,
      end: { line, column, offset },
      inclusive: false,
      linewise: true,
    };
  },
};

/**
 * Motion: { - move backward to previous blank line (paragraph boundary)
 */
export const paragraphBackward: Motion = {
  name: "{",
  linewise: true,
  calculate: (cursor: Position, lines: string[], count = 1): VimRange => {
    let line = cursor.line;

    for (let c = 0; c < count; c++) {
      // If currently on a blank line, skip past consecutive blank lines going up
      while (line > 0 && lines[line].trim() === "") {
        line--;
      }
      // Now skip past non-blank lines (the paragraph body) going up
      while (line > 0 && lines[line].trim() !== "") {
        line--;
      }
      // We're now on a blank line or at line 0
    }

    const column = 0;
    const offset = calculateOffsetFromPosition(line, column, lines);

    return {
      start: cursor,
      end: { line, column, offset },
      inclusive: false,
      linewise: true,
    };
  },
};
