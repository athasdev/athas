import type React from "react";
import { useCallback } from "react";
import { useCodeEditorStore } from "../stores/code-editor-store";
import { getCursorPosition } from "./use-vim";

export const useEditorScroll = (
  editorRef: React.RefObject<HTMLDivElement | null>,
  highlightRef: React.RefObject<HTMLPreElement | null>,
  lineNumbersRef: React.RefObject<HTMLDivElement | null>,
) => {
  // Store subscriptions
  const setCursorPosition = useCodeEditorStore(state => state.setCursorPosition);
  const setIsTyping = useCodeEditorStore(state => state.setIsTyping);

  // Sync scroll between contenteditable, highlight layer, and line numbers
  const handleScroll = useCallback(() => {
    if (editorRef.current && highlightRef.current && lineNumbersRef.current) {
      const scrollTop = editorRef.current.scrollTop;
      const scrollLeft = editorRef.current.scrollLeft;

      highlightRef.current.scrollTop = scrollTop;
      highlightRef.current.scrollLeft = scrollLeft;
      lineNumbersRef.current.scrollTop = scrollTop;
    }
  }, [editorRef, highlightRef, lineNumbersRef]);

  // Handle cursor position changes
  const handleCursorPositionChange = useCallback(
    (
      onCursorPositionChange?: (position: number) => void,
      filePath?: string,
      isLanguageSupported?: (filePath: string) => boolean,
      vimEnabled?: boolean,
      vimMode?: string,
      handleLspCompletion?: (
        pos: number,
        editorRef: React.RefObject<HTMLDivElement | null>,
      ) => void,
    ) => {
      if (editorRef.current) {
        // Use the getCursorPosition utility for contenteditable
        const position = getCursorPosition(editorRef.current);
        setCursorPosition(position);

        if (onCursorPositionChange) {
          onCursorPositionChange(position);
        }

        // Skip LSP for remote files to avoid delays
        const isRemoteFile = filePath?.startsWith("remote://");

        // Trigger LSP completion if supported and in insert mode (or vim disabled)
        if (
          !isRemoteFile &&
          handleLspCompletion &&
          isLanguageSupported?.(filePath || "") &&
          (!vimEnabled || vimMode === "insert")
        ) {
          handleLspCompletion(position, editorRef);
        }
      }
    },
    [editorRef, setCursorPosition],
  );

  // Handle user interaction (typing, clicking, etc.)
  const handleUserInteraction = useCallback(() => {
    setIsTyping(true);

    // Reset typing state after a short delay
    setTimeout(() => {
      setIsTyping(false);
    }, 1000);
  }, [setIsTyping]);

  return {
    handleScroll,
    handleCursorPositionChange,
    handleUserInteraction,
  };
};
