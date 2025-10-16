/**
 * Delete operator (d)
 */

import { calculateOffsetFromPosition } from "@/utils/editor-position";
import type { EditorContext, Operator, VimRange } from "../core/types";

/**
 * Delete operator - removes text in the given range
 */
export const deleteOperator: Operator = {
  name: "delete",
  repeatable: true,
  entersInsertMode: false,

  execute: (range: VimRange, context: EditorContext): void => {
    const { content, lines, updateContent, setCursorPosition } = context;

    // Handle linewise deletion
    if (range.linewise) {
      const newLines = lines.filter((_, index) => {
        return index < range.start.line || index > range.end.line;
      });

      const newContent = newLines.length > 0 ? newLines.join("\n") : "";
      updateContent(newContent);

      // Position cursor at start of deletion (or beginning of file)
      const newLine = Math.min(range.start.line, newLines.length - 1);
      const newColumn = 0;
      const newOffset =
        newLines.length > 0 ? calculateOffsetFromPosition(newLine, newColumn, newLines) : 0;

      setCursorPosition({
        line: Math.max(0, newLine),
        column: newColumn,
        offset: newOffset,
      });

      return;
    }

    // Handle character-wise deletion
    const startOffset = Math.min(range.start.offset, range.end.offset);
    const endOffset = Math.max(range.start.offset, range.end.offset);

    // For inclusive ranges, include the end character
    const actualEndOffset = range.inclusive ? endOffset + 1 : endOffset;

    const newContent = content.slice(0, startOffset) + content.slice(actualEndOffset);

    updateContent(newContent);

    // Position cursor at start of deletion
    const newLines = newContent.split("\n");
    let line = 0;
    let offset = 0;

    // Find the line containing the start offset
    for (let i = 0; i < newLines.length; i++) {
      if (offset + newLines[i].length >= startOffset) {
        line = i;
        break;
      }
      offset += newLines[i].length + 1; // +1 for newline
    }

    const column = startOffset - offset;

    setCursorPosition({
      line,
      column: Math.max(0, column),
      offset: startOffset,
    });
  },
};
