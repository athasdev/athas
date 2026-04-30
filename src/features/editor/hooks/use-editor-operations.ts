import { useCallback } from "react";
import {
  indentText,
  outdentText,
  type TextOperationResult,
  toggleCaseText,
} from "../utils/text-operations";

interface UseEditorOperationsParams {
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  content: string;
  bufferId: string | null;
  updateBufferContent: (bufferId: string, content: string) => void;
  handleInput: (content: string) => void;
  tabSize: number;
}

export function useEditorOperations({
  inputRef,
  content,
  bufferId,
  updateBufferContent,
  handleInput,
  tabSize,
}: UseEditorOperationsParams) {
  const applyTextOperation = useCallback(
    (result: TextOperationResult) => {
      if (!inputRef.current) return;
      const textarea = inputRef.current;

      if (bufferId) {
        updateBufferContent(bufferId, result.content);
      }

      textarea.value = result.content;
      textarea.selectionStart = result.selectionStart;
      textarea.selectionEnd = result.selectionEnd;
      handleInput(result.content);
    },
    [bufferId, handleInput, inputRef, updateBufferContent],
  );

  const copy = useCallback(() => {
    if (!inputRef.current) return;
    document.execCommand("copy");
  }, [inputRef]);

  const cut = useCallback(() => {
    if (!inputRef.current) return;
    document.execCommand("cut");
  }, [inputRef]);

  const paste = useCallback(async () => {
    if (!inputRef.current) return;
    try {
      const text = await navigator.clipboard.readText();
      const textarea = inputRef.current;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newContent = content.substring(0, start) + text + content.substring(end);

      if (bufferId) {
        updateBufferContent(bufferId, newContent);
      }

      textarea.value = newContent;
      const newPosition = start + text.length;
      textarea.selectionStart = textarea.selectionEnd = newPosition;

      handleInput(newContent);
    } catch (error) {
      console.error("Failed to paste:", error);
    }
  }, [content, bufferId, updateBufferContent, handleInput, inputRef]);

  const selectAll = useCallback(() => {
    if (!inputRef.current) return;
    inputRef.current.select();
  }, [inputRef]);

  const deleteSelection = useCallback(() => {
    if (!inputRef.current) return;
    const textarea = inputRef.current;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    if (start !== end) {
      const newContent = content.substring(0, start) + content.substring(end);
      if (bufferId) {
        updateBufferContent(bufferId, newContent);
      }
      textarea.value = newContent;
      textarea.selectionStart = textarea.selectionEnd = start;
      handleInput(newContent);
    }
  }, [content, bufferId, updateBufferContent, handleInput, inputRef]);

  const indent = useCallback(() => {
    if (!inputRef.current) return;
    const textarea = inputRef.current;
    applyTextOperation(
      indentText(content, textarea.selectionStart, textarea.selectionEnd, " ".repeat(tabSize)),
    );
  }, [applyTextOperation, content, inputRef, tabSize]);

  const outdent = useCallback(() => {
    if (!inputRef.current) return;
    const textarea = inputRef.current;
    applyTextOperation(
      outdentText(content, textarea.selectionStart, textarea.selectionEnd, tabSize),
    );
  }, [applyTextOperation, content, inputRef, tabSize]);

  const toggleCase = useCallback(() => {
    if (!inputRef.current) return;
    const textarea = inputRef.current;
    applyTextOperation(toggleCaseText(content, textarea.selectionStart, textarea.selectionEnd));
  }, [applyTextOperation, content, inputRef]);

  return {
    copy,
    cut,
    paste,
    selectAll,
    deleteSelection,
    indent,
    outdent,
    toggleCase,
  };
}
