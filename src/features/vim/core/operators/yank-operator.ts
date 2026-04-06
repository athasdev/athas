/**
 * Yank operator (y)
 */

import { useVimStore } from "@/features/vim/stores/vim-store";
import type { EditorContext, Operator, VimRange } from "../core/types";

/**
 * Vim clipboard for yanked content (legacy interface kept for compatibility)
 */
interface VimClipboard {
  content: string;
  linewise: boolean;
}

/**
 * Yank operator - copies text to vim registers
 */
export const yankOperator: Operator = {
  name: "yank",
  repeatable: false,
  entersInsertMode: false,

  execute: (range: VimRange, context: EditorContext): void => {
    const { content, lines } = context;

    if (range.linewise) {
      const startLine = Math.min(range.start.line, range.end.line);
      const endLine = Math.max(range.start.line, range.end.line);
      const yankedLines = lines.slice(startLine, endLine + 1);
      const yankedContent = yankedLines.join("\n");

      useVimStore.getState().actions.writeToRegister(yankedContent, true, false);
      return;
    }

    const startOffset = Math.min(range.start.offset, range.end.offset);
    const endOffset = Math.max(range.start.offset, range.end.offset);
    const actualEndOffset = range.inclusive ? endOffset + 1 : endOffset;
    const yankedContent = content.slice(startOffset, actualEndOffset);

    useVimStore.getState().actions.writeToRegister(yankedContent, false, false);
  },
};

/**
 * Get the current vim clipboard content (reads from register system)
 */
export const getVimClipboard = (): VimClipboard => {
  const entry = useVimStore.getState().registers.get("");
  if (entry) {
    return { content: entry.content, linewise: entry.linewise };
  }
  return { content: "", linewise: false };
};

/**
 * Set the vim clipboard content (writes to register system)
 */
export const setVimClipboard = (clipboard: VimClipboard): void => {
  useVimStore.getState().actions.writeToRegister(clipboard.content, clipboard.linewise, true);
};
