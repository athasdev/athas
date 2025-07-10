import type React from "react";
import { useCallback } from "react";
import { useCodeEditorStore } from "../store/code-editor-store";

export const useEditorScroll = (
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
  highlightRef: React.RefObject<HTMLPreElement | null>,
  lineNumbersRef: React.RefObject<HTMLDivElement | null>,
) => {
  // Store subscriptions
  const setCursorPosition = useCodeEditorStore(state => state.setCursorPosition);
  const setIsTyping = useCodeEditorStore(state => state.setIsTyping);

  // Sync scroll between textarea, highlight layer, and line numbers
  const handleScroll = useCallback(() => {
    if (textareaRef.current && highlightRef.current && lineNumbersRef.current) {
      const scrollTop = textareaRef.current.scrollTop;
      const scrollLeft = textareaRef.current.scrollLeft;

      highlightRef.current.scrollTop = scrollTop;
      highlightRef.current.scrollLeft = scrollLeft;
      lineNumbersRef.current.scrollTop = scrollTop;
    }
  }, [textareaRef, highlightRef, lineNumbersRef]);

  // Handle cursor position changes
  const handleCursorPositionChange = useCallback(
    (
      onCursorPositionChange?: (position: number) => void,
      filePath?: string,
      isLanguageSupported?: (filePath: string) => boolean,
      vimEnabled?: boolean,
      vimMode?: string,
      handleLspCompletion?: (position: number) => void,
    ) => {
      if (textareaRef.current) {
        const position = textareaRef.current.selectionStart;
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
          handleLspCompletion(position);
        }
      }
    },
    [textareaRef, setCursorPosition],
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
