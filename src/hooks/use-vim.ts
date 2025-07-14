import type React from "react";
import { useEffect, useRef } from "react";
import { VimEngine } from "./vim/vim-engine";
import type { VimMode } from "./vim/vim-types";

export const useVim = (
  _editorRef: React.RefObject<HTMLDivElement>,
  _content: string,
  onChange: (content: string) => void,
  enabled: boolean,
  onCursorPositionChange: (pos: number) => void,
  onModeChange: (mode: VimMode) => void,
  onShowCommandLine: (initialCommand?: string) => void,
) => {
  const vimEngineRef = useRef<VimEngine | null>(null);

  // Initialize vim engine
  useEffect(() => {
    if (enabled && !vimEngineRef.current) {
      vimEngineRef.current = new VimEngine(
        onCursorPositionChange,
        onChange,
        onModeChange,
        onShowCommandLine,
      );
    } else if (!enabled) {
      vimEngineRef.current = null;
    }
  }, [enabled, onCursorPositionChange, onChange, onModeChange, onShowCommandLine]);

  return {
    vimEngine: vimEngineRef.current,
  };
};

// Helper function to get cursor position in contenteditable
export const getCursorPosition = (element: HTMLDivElement): number => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return 0;

  const range = selection.getRangeAt(0);
  const preCaretRange = range.cloneRange();
  preCaretRange.selectNodeContents(element);
  preCaretRange.setEnd(range.endContainer, range.endOffset);

  return preCaretRange.toString().length;
};

// Helper function to set cursor position in contenteditable
export const setCursorPosition = (element: HTMLDivElement, position: number): void => {
  const selection = window.getSelection();
  if (!selection) return;

  const range = document.createRange();
  let currentPos = 0;
  let found = false;

  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);

  let node = walker.nextNode();
  while (node && !found) {
    const textLength = node.textContent?.length || 0;
    if (currentPos + textLength >= position) {
      range.setStart(node, position - currentPos);
      range.setEnd(node, position - currentPos);
      found = true;
    } else {
      currentPos += textLength;
      node = walker.nextNode();
    }
  }

  if (!found && element.childNodes.length > 0) {
    // Position is beyond the text, place at the end
    const lastNode = element.childNodes[element.childNodes.length - 1];
    if (lastNode.nodeType === Node.TEXT_NODE) {
      range.setStart(lastNode, lastNode.textContent?.length || 0);
      range.setEnd(lastNode, lastNode.textContent?.length || 0);
    } else {
      range.setStartAfter(lastNode);
      range.setEndAfter(lastNode);
    }
  }

  selection.removeAllRanges();
  selection.addRange(range);
};
