/**
 * Indent operator (>)
 */

import { calculateOffsetFromPosition } from "@/features/editor/utils/position";
import type { EditorContext, Operator, VimRange } from "../core/types";

/**
 * Indent operator - indents text in the given range
 */
export const indentOperator: Operator = {
  name: "indent",
  repeatable: true,
  entersInsertMode: false,

  execute: (range: VimRange, context: EditorContext): void => {
    const { lines, updateContent, setCursorPosition, cursor, tabSize } = context;

    const startLine = Math.min(range.start.line, range.end.line);
    const endLine = Math.max(range.start.line, range.end.line);

    const indentedLines = lines.map((line, index) => {
      if (index >= startLine && index <= endLine) {
        return " ".repeat(tabSize) + line;
      }
      return line;
    });
    const indentedContent = indentedLines.join("\n");
    updateContent(indentedContent);

    // Adjust cursor column if it was on an indented line
    const cursorWasInRange = cursor.line >= startLine && cursor.line <= endLine;
    const newColumn = cursorWasInRange ? cursor.column + tabSize : cursor.column;
    const newOffset = calculateOffsetFromPosition(cursor.line, newColumn, indentedLines);

    setCursorPosition({
      line: cursor.line,
      column: newColumn,
      offset: newOffset,
    });
  },
};
