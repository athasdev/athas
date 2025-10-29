/**
 * Replace action (r)
 */

import { calculateCursorPosition } from "@/utils/editor-position";
import type { Action, EditorContext } from "../core/types";
import { setVimClipboard } from "../operators/yank-operator";

/**
 * Replace action factory - creates a replace action for a specific character
 */
export const createReplaceAction = (char: string, count = 1): Action => ({
  name: `replace-${char}`,
  repeatable: true,

  execute: (context: EditorContext): void => {
    const { content, updateContent, setCursorPosition, cursor } = context;

    if (cursor.offset >= content.length) {
      return;
    }

    const effectiveCount = Math.max(1, count);
    const replaceEnd = Math.min(content.length, cursor.offset + effectiveCount);
    const replacedSegment = content.slice(cursor.offset, replaceEnd);

    if (!replacedSegment) {
      return;
    }

    // Store replaced characters in clipboard for undo/redo parity
    setVimClipboard({ content: replacedSegment, linewise: false });

    const replacementText = char.repeat(replacedSegment.length);
    const newContent =
      content.slice(0, cursor.offset) + replacementText + content.slice(replaceEnd);

    updateContent(newContent);

    const newLines = newContent.split("\n");
    const newCursorOffset = Math.min(
      newContent.length === 0 ? 0 : newContent.length - 1,
      cursor.offset + Math.max(replacementText.length - 1, 0),
    );
    const newCursorPosition = calculateCursorPosition(newCursorOffset, newLines);

    setCursorPosition(newCursorPosition);

    // Update textarea cursor
    const textarea = document.querySelector(".editor-textarea") as HTMLTextAreaElement;
    if (textarea) {
      textarea.selectionStart = textarea.selectionEnd = newCursorPosition.offset;
      textarea.dispatchEvent(new Event("select"));
    }
  },
});

/**
 * Generic replace action - the character to replace with should be set dynamically
 */
export const replaceAction: Action = {
  name: "replace",
  repeatable: true,

  execute: (_context: EditorContext): void => {
    // This will be handled specially in the keyboard handler
    console.warn("Replace action called without character - should be handled by keyboard handler");
  },
};
