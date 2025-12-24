/**
 * Delete operator (d)
 */

import { calculateOffsetFromPosition } from "@/features/editor/utils/position";
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
