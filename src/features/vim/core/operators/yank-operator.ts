/**
 * Yank operator (y)
 */

import { useVimStore } from "../../stores/vim-store";
import type { EditorContext, Operator, VimRange } from "../core/types";

/**
 * Vim clipboard for yanked content
 */
interface VimClipboard {
  content: string;
  linewise: boolean;
}

let vimClipboard: VimClipboard = {
  content: "",
  linewise: false,
};

/**
 * Yank operator - copies text to vim clipboard
 */
export const yankOperator: Operator = {
  name: "yank",
  repeatable: false, // Yanking doesn't need to be repeated with dot
  entersInsertMode: false,

  execute: (range: VimRange, context: EditorContext): void => {
    const { content, lines } = context;

    // Handle linewise yank
    if (range.linewise) {
      const startLine = Math.min(range.start.line, range.end.line);
      const endLine = Math.max(range.start.line, range.end.line);
      const yankedLines = lines.slice(startLine, endLine + 1);
      const yankedContent = yankedLines.join("\n");
      vimClipboard = {
        content: yankedContent,
        linewise: true,
      };

      // Also store in vim store's register system
      const vimStore = useVimStore.getState();
      const registerName = vimStore.activeRegister || '"';
      vimStore.actions.setRegisterContent(registerName, yankedContent, "line");

      return;
    }

    // Handle character-wise yank
    const startOffset = Math.min(range.start.offset, range.end.offset);
    const endOffset = Math.max(range.start.offset, range.end.offset);

    // For inclusive ranges, include the end character
    const actualEndOffset = range.inclusive ? endOffset + 1 : endOffset;
    const yankedContent = content.slice(startOffset, actualEndOffset);

    vimClipboard = {
      content: yankedContent,
      linewise: false,
    };

    // Also store in vim store's register system
    const vimStore = useVimStore.getState();
    const registerName = vimStore.activeRegister || '"';
    vimStore.actions.setRegisterContent(registerName, yankedContent, "char");
  },
};

/**
 * Get the current vim clipboard content
 */
export const getVimClipboard = (): VimClipboard => {
  return { ...vimClipboard };
};

/**
 * Set the vim clipboard content (useful for paste operations)
 */
export const setVimClipboard = (clipboard: VimClipboard): void => {
  vimClipboard = clipboard;
};
