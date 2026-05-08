/**
 * Outdent operator (<)
 */

import { calculateOffsetFromPosition } from "@/features/editor/utils/position";
import type { EditorContext, Operator, VimRange } from "../core/types";

/**
 * Outdent operator - outdents text in the given range
 */
export const outdentOperator: Operator = {
  name: "outdent",
  repeatable: true,
  entersInsertMode: false,

  execute: (range: VimRange, context: EditorContext): void => {
    const { lines, updateContent, setCursorPosition, cursor, tabSize } = context;

    const startLine = Math.min(range.start.line, range.end.line);
    const endLine = Math.max(range.start.line, range.end.line);

    const outdentedLines = lines.map((line, index) => {
      if (index >= startLine && index <= endLine) {
        const spacesToRemove = Math.min(tabSize, line.length - line.trimStart().length);
        return line.slice(spacesToRemove);
      }
      return line;
    });
    const outdentedContent = outdentedLines.join("\n");
    updateContent(outdentedContent);

    // Adjust cursor column if it was on an outdented line
    const originalLine = lines[cursor.line] ?? "";
    const spacesRemoved = Math.min(tabSize, originalLine.length - originalLine.trimStart().length);
    const cursorWasInRange = cursor.line >= startLine && cursor.line <= endLine;
    const newColumn = cursorWasInRange ? Math.max(0, cursor.column - spacesRemoved) : cursor.column;
    const newOffset = calculateOffsetFromPosition(cursor.line, newColumn, outdentedLines);

    setCursorPosition({
      line: cursor.line,
      column: newColumn,
      offset: newOffset,
    });
  },
};
