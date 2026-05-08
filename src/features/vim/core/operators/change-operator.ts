/**
 * Change operator (c)
 */

import { calculateOffsetFromPosition } from "@/features/editor/utils/position";
import type { EditorContext, Operator, VimRange } from "../core/types";
import { deleteOperator } from "./delete-operator";

/**
 * Change operator - deletes text and enters insert mode.
 * For linewise changes (cc), preserves leading indentation.
 */
export const changeOperator: Operator = {
  name: "change",
  repeatable: true,
  entersInsertMode: true,

  execute: (range: VimRange, context: EditorContext): void => {
    // For linewise changes, preserve leading whitespace
    if (range.linewise) {
      const { lines, cursor, updateContent, setCursorPosition } = context;
      const targetLine = range.start.line;
      const originalLine = lines[targetLine] ?? "";
      const leadingWhitespace = originalLine.match(/^\s*/)?.[0] ?? "";

      // Delete the line content but keep the line itself with leading whitespace
      const newLines = [...lines];
      newLines[targetLine] = leadingWhitespace;
      const newContent = newLines.join("\n");
      updateContent(newContent);

      const newColumn = leadingWhitespace.length;
      const newOffset = calculateOffsetFromPosition(targetLine, newColumn, newLines);
      setCursorPosition({
        line: targetLine,
        column: newColumn,
        offset: newOffset,
      });
      return;
    }

    // Character-wise change: delegate to delete
    deleteOperator.execute(range, context);
  },
};
