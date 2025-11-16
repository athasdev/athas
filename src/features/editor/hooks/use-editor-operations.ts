import { useCallback } from "react";

interface UseEditorOperationsParams {
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  content: string;
  bufferId: string | null;
  updateBufferContent: (bufferId: string, content: string) => void;
  handleInput: (content: string) => void;
}

export function useEditorOperations({
  inputRef,
  content,
  bufferId,
  updateBufferContent,
  handleInput,
}: UseEditorOperationsParams) {
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

  return {
    copy,
    cut,
    paste,
    selectAll,
    deleteSelection,
  };
}
