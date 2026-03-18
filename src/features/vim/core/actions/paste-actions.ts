/**
 * Paste actions (p, P)
 */

import { calculateOffsetFromPosition } from "@/features/editor/utils/position";
import { useVimStore } from "@/features/vim/stores/vim-store";
import type { Action, EditorContext } from "../core/types";

/**
 * Read from the current register (or unnamed if none selected)
 */
const readPasteRegister = (): { content: string; linewise: boolean } | undefined => {
  return useVimStore.getState().actions.readFromRegister();
};

/**
 * Paste after cursor (p)
 */
export const pasteAction: Action = {
  name: "paste",
  repeatable: true,
  entersInsertMode: false,

  execute: (context: EditorContext): void => {
    const clipboard = readPasteRegister();
    if (!clipboard?.content) return;

    const { content, lines, updateContent, setCursorPosition, cursor } = context;

    if (clipboard.linewise) {
      const newLines = [...lines];
      const pastedLines = clipboard.content.replace(/\n$/, "").split("\n");

      newLines.splice(cursor.line + 1, 0, ...pastedLines);
      const newContent = newLines.join("\n");

      const newLine = cursor.line + 1;
      const newOffset = calculateOffsetFromPosition(newLine, 0, newLines);

      updateContent(newContent);
      setCursorPosition({
        line: newLine,
        column: 0,
        offset: newOffset,
      });
    } else {
      let pasteOffset = cursor.offset;

      if (cursor.offset < content.length && content[cursor.offset] !== "\n") {
        pasteOffset = cursor.offset + 1;
      }

      const newContent =
        content.slice(0, pasteOffset) + clipboard.content + content.slice(pasteOffset);

      updateContent(newContent);

      const newOffset = pasteOffset + clipboard.content.length - 1;
      const newLines = newContent.split("\n");
      let line = 0;
      let offset = 0;

      for (let i = 0; i < newLines.length; i++) {
        if (offset + newLines[i].length >= newOffset) {
          line = i;
          break;
        }
        offset += newLines[i].length + 1;
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
    const clipboard = readPasteRegister();
    if (!clipboard?.content) return;

    const { content, lines, updateContent, setCursorPosition, cursor } = context;

    if (clipboard.linewise) {
      const newLines = [...lines];
      const pastedLines = clipboard.content.replace(/\n$/, "").split("\n");

      newLines.splice(cursor.line, 0, ...pastedLines);
      const newContent = newLines.join("\n");

      const newLine = cursor.line;
      const newOffset = calculateOffsetFromPosition(newLine, 0, newLines);

      updateContent(newContent);
      setCursorPosition({
        line: newLine,
        column: 0,
        offset: newOffset,
      });
    } else {
      const newContent =
        content.slice(0, cursor.offset) + clipboard.content + content.slice(cursor.offset);

      updateContent(newContent);

      const newOffset = cursor.offset + clipboard.content.length - 1;
      const newLines = newContent.split("\n");
      let line = 0;
      let offset = 0;

      for (let i = 0; i < newLines.length; i++) {
        if (offset + newLines[i].length >= newOffset) {
          line = i;
          break;
        }
        offset += newLines[i].length + 1;
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
