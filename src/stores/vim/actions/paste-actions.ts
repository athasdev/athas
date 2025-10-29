/**
 * Paste actions (p, P)
 */

import { calculateOffsetFromPosition } from "@/utils/editor-position";
import type { Action, EditorContext } from "../core/types";
import { getVimClipboard } from "../operators/yank-operator";

/**
 * Paste after cursor (p)
 */
export const pasteAction: Action = {
  name: "paste",
  repeatable: true,
  entersInsertMode: false,

  execute: (context: EditorContext): void => {
    const clipboard = getVimClipboard();
    if (!clipboard.content) return;

    const { content, lines, updateContent, setCursorPosition, cursor } = context;

    if (clipboard.linewise) {
      // Paste as new line below current line
      const newLines = [...lines];
      const pastedLines = clipboard.content.replace(/\n$/, "").split("\n");

      // Insert after current line
      newLines.splice(cursor.line + 1, 0, ...pastedLines);
      const newContent = newLines.join("\n");

      // Move cursor to beginning of first pasted line
      const newLine = cursor.line + 1;
      const newOffset = calculateOffsetFromPosition(newLine, 0, newLines);

      updateContent(newContent);
      setCursorPosition({
        line: newLine,
        column: 0,
        offset: newOffset,
      });
    } else {
      // Character-wise paste after cursor
      let pasteOffset = cursor.offset;

      // If not at end of line, move one character right
      if (cursor.offset < content.length && content[cursor.offset] !== "\n") {
        pasteOffset = cursor.offset + 1;
      }

      const newContent =
        content.slice(0, pasteOffset) + clipboard.content + content.slice(pasteOffset);

      updateContent(newContent);

      // Move cursor to end of pasted content - 1 (vim behavior)
      const newOffset = pasteOffset + clipboard.content.length - 1;
      const newLines = newContent.split("\n");
      let line = 0;
      let offset = 0;

      // Find the line containing the new cursor offset
      for (let i = 0; i < newLines.length; i++) {
        if (offset + newLines[i].length >= newOffset) {
          line = i;
          break;
        }
        offset += newLines[i].length + 1; // +1 for newline
      }

      const column = newOffset - offset;
      setCursorPosition({
        line,
        column: Math.max(0, column),
        offset: Math.max(0, newOffset),
      });
    }
  },
};

/**
 * Paste before cursor (P)
 */
export const pasteBeforeAction: Action = {
  name: "paste-before",
  repeatable: true,
  entersInsertMode: false,

  execute: (context: EditorContext): void => {
    const clipboard = getVimClipboard();
    if (!clipboard.content) return;

    const { content, lines, updateContent, setCursorPosition, cursor } = context;

    if (clipboard.linewise) {
      // Paste as new line above current line
      const newLines = [...lines];
      const pastedLines = clipboard.content.replace(/\n$/, "").split("\n");

      // Insert before current line
      newLines.splice(cursor.line, 0, ...pastedLines);
      const newContent = newLines.join("\n");

      // Move cursor to beginning of first pasted line
      const newLine = cursor.line;
      const newOffset = calculateOffsetFromPosition(newLine, 0, newLines);

      updateContent(newContent);
      setCursorPosition({
        line: newLine,
        column: 0,
        offset: newOffset,
      });
    } else {
      // Character-wise paste at cursor
      const newContent =
        content.slice(0, cursor.offset) + clipboard.content + content.slice(cursor.offset);

      updateContent(newContent);

      // Move cursor to end of pasted content - 1 (vim behavior)
      const newOffset = cursor.offset + clipboard.content.length - 1;
      const newLines = newContent.split("\n");
      let line = 0;
      let offset = 0;

      // Find the line containing the new cursor offset
      for (let i = 0; i < newLines.length; i++) {
        if (offset + newLines[i].length >= newOffset) {
          line = i;
          break;
        }
        offset += newLines[i].length + 1; // +1 for newline
      }

      const column = newOffset - offset;
      setCursorPosition({
        line,
        column: Math.max(0, column),
        offset: Math.max(0, newOffset),
      });
    }
  },
};
