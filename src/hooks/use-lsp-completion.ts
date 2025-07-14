import { useCallback, useRef } from "react";
import type { CompletionItem } from "vscode-languageserver-protocol";
import { useCodeEditorStore } from "../stores/code-editor-store";

interface UseLspCompletionProps {
  getCompletions?: (filePath: string, line: number, character: number) => Promise<CompletionItem[]>;
  isLanguageSupported?: (filePath: string) => boolean;
  filePath: string;
  value: string;
  fontSize: number;
  lineNumbers: boolean;
}

export const useLspCompletion = ({
  getCompletions,
  isLanguageSupported,
  filePath,
  value,
  fontSize,
  lineNumbers,
}: UseLspCompletionProps) => {
  const mountedRef = useRef(true);

  const setLspCompletions = useCodeEditorStore(state => state.setLspCompletions);
  const setSelectedLspIndex = useCodeEditorStore(state => state.setSelectedLspIndex);
  const setIsLspCompletionVisible = useCodeEditorStore(state => state.setIsLspCompletionVisible);
  const setCompletionPosition = useCodeEditorStore(state => state.setCompletionPosition);

  const handleLspCompletion = useCallback(
    async (cursorPos: number, editorRef: React.RefObject<HTMLDivElement | null>) => {
      if (
        !mountedRef.current ||
        !getCompletions ||
        !filePath ||
        !isLanguageSupported?.(filePath) ||
        !editorRef.current
      ) {
        return;
      }

      const isRemoteFile = filePath?.startsWith("remote://");
      if (isRemoteFile) return;

      const lines = value.substring(0, cursorPos).split("\n");
      const line = lines.length - 1;
      const character = lines[lines.length - 1].length;

      try {
        const completions = await getCompletions(filePath, line, character);
        if (!mountedRef.current) return;
        if (completions.length > 0) {
          setLspCompletions(completions);
          setSelectedLspIndex(0);
          setIsLspCompletionVisible(true);

          // Calculate completion position
          const editor = editorRef.current;
          const rect = editor.getBoundingClientRect();
          const lineHeight = fontSize * 1.4;
          const charWidth = fontSize * 0.6;
          const paddingLeft = lineNumbers ? 16 : 16;
          const paddingTop = 16;
          const scrollLeft = editor.scrollLeft;
          const scrollTop = editor.scrollTop;

          const x = rect.left + character * charWidth + paddingLeft - scrollLeft;
          const y = rect.top + (line + 1) * lineHeight + paddingTop - scrollTop;

          const dropdownHeight = Math.min(completions.length * 40, 320);
          const dropdownWidth = 320;

          let finalX = x;
          let finalY = y;

          if (finalX + dropdownWidth > window.innerWidth - 10) {
            finalX = Math.max(10, x - dropdownWidth);
          }

          if (finalY + dropdownHeight > window.innerHeight - 10) {
            finalY = Math.max(10, y - dropdownHeight - lineHeight);
          }

          setCompletionPosition({ top: finalY, left: finalX });
        }
      } catch (error) {
        console.error("LSP completion error:", error);
      }
    },
    [
      getCompletions,
      isLanguageSupported,
      filePath,
      value,
      fontSize,
      lineNumbers,
      setLspCompletions,
      setSelectedLspIndex,
      setIsLspCompletionVisible,
      setCompletionPosition,
    ],
  );

  const applyLspCompletion = useCallback(
    (
      completion: CompletionItem,
      editorRef: React.RefObject<HTMLDivElement | null>,
      onChange: (value: string) => void,
    ) => {
      if (!editorRef.current) return;
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;

      const range = selection.getRangeAt(0);
      const cursorPos = range.startOffset;
      const before = value.substring(0, cursorPos);
      const after = value.substring(cursorPos);
      const wordMatch = before.match(/\w*$/);
      const wordStart = wordMatch ? cursorPos - wordMatch[0].length : cursorPos;
      const insertText = completion.insertText || completion.label;
      const newValue = value.substring(0, wordStart) + insertText + after;
      onChange(newValue);
      const newCursorPos = wordStart + insertText.length;
      requestAnimationFrame(() => {
        if (editorRef.current) {
          const range = document.createRange();
          const textNode = editorRef.current.firstChild;
          if (textNode) {
            range.setStart(textNode, newCursorPos);
            range.setEnd(textNode, newCursorPos);
            selection.removeAllRanges();
            selection.addRange(range);
          }
          editorRef.current.focus();
        }
      });
      setIsLspCompletionVisible(false);
    },
    [value, setIsLspCompletionVisible],
  );

  const handleCompletionClose = useCallback(() => {
    setIsLspCompletionVisible(false);
  }, [setIsLspCompletionVisible]);

  return {
    handleLspCompletion,
    applyLspCompletion,
    handleCompletionClose,
  };
};
