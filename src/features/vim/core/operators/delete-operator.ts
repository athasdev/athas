/**
 * Delete operator (d)
 */

import {
  calculateCursorPosition,
  calculateOffsetFromPosition,
} from "@/features/editor/utils/position";
import type { EditorContext, Operator, VimRange } from "../core/types";
import { setVimClipboard } from "./yank-operator";

/**
 * Delete operator - removes text in the given range and saves to clipboard
 */
export const deleteOperator: Operator = {
  name: "delete",
  repeatable: true,
  entersInsertMode: false,

  execute: (range: VimRange, context: EditorContext): void => {
    const { content, lines, updateContent, setCursorPosition } = context;

    // Handle linewise deletion
    if (range.linewise) {
      const startLine = Math.min(range.start.line, range.end.line);
      const endLine = Math.max(range.start.line, range.end.line);

      // Save deleted lines to clipboard
      const deletedLines = lines.slice(startLine, endLine + 1);
      const deletedContent = `${deletedLines.join("\n")}\n`;
      setVimClipboard({
        content: deletedContent,
        linewise: true,
      });

      const newLines = lines.filter((_, index) => {
        return index < startLine || index > endLine;
      });

      const newContent = newLines.length > 0 ? newLines.join("\n") : "";
      updateContent(newContent);

      // Position cursor at start of deletion (or beginning of file)
      const newLine = newLines.length > 0 ? Math.min(startLine, newLines.length - 1) : 0;
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

    // Save deleted content to clipboard
    const deletedContent = content.slice(startOffset, actualEndOffset);
    setVimClipboard({
      content: deletedContent,
      linewise: false,
    });

    const newContent = content.slice(0, startOffset) + content.slice(actualEndOffset);

    updateContent(newContent);

    // Position cursor at start of deletion
    const newLines = newContent.split("\n");
    const newCursorPosition = calculateCursorPosition(startOffset, newLines);
    setCursorPosition(newCursorPosition);
  },
};
