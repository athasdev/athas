/**
 * Cursor position save/restore for contenteditable
 */

import { type RefObject, useCallback } from "react";

export function useCursor(ref: RefObject<HTMLElement | null>) {
  const save = useCallback((): number | null => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !ref.current) return null;

    const range = selection.getRangeAt(0);
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(ref.current);
    preCaretRange.setEnd(range.endContainer, range.endOffset);

    return preCaretRange.toString().length;
  }, [ref]);

  const restore = useCallback(
    (offset: number) => {
      if (!ref.current) return;

      const selection = window.getSelection();
      if (!selection) return;

      let currentOffset = 0;
      const walk = document.createTreeWalker(ref.current, NodeFilter.SHOW_TEXT, null);

      let node = walk.nextNode();
      while (node) {
        const nodeLength = node.textContent?.length || 0;

        if (currentOffset + nodeLength >= offset) {
          const range = document.createRange();
          range.setStart(node, offset - currentOffset);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
          return;
        }

        currentOffset += nodeLength;
        node = walk.nextNode();
      }
    },
    [ref],
  );

  return { save, restore };
}
