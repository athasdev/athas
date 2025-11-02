import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { type RefObject, useCallback } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useEditorStateStore } from "@/features/editor/stores/state-store";

// Manages clipboard operations (copy/cut/paste)
export function useClipboard(
  textareaRef: RefObject<HTMLTextAreaElement>,
  content: string,
  onChange?: (content: string) => void,
  handleSelectionChange?: () => void,
) {
  const activeBufferId = useBufferStore.use.activeBufferId();
  const { updateBufferContent } = useBufferStore.use.actions();

  const handleCopy = useCallback(async () => {
    const selection = useEditorStateStore.getState().selection;
    if (selection && textareaRef.current) {
      const selectedText = content.slice(selection.start.offset, selection.end.offset);
      try {
        await navigator.clipboard.writeText(selectedText);
      } catch (error) {
        console.error("Failed to copy text:", error);
      }
    }
  }, [content, textareaRef]);

  const handleCut = useCallback(async () => {
    const selection = useEditorStateStore.getState().selection;
    if (selection && textareaRef.current) {
      const selectedText = content.slice(selection.start.offset, selection.end.offset);
      try {
        await navigator.clipboard.writeText(selectedText);

        // Remove the selected text
        const newContent =
          content.slice(0, selection.start.offset) + content.slice(selection.end.offset);
        onChange?.(newContent);
        if (activeBufferId) {
          updateBufferContent(activeBufferId, newContent);
        }

        // Update cursor position
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.selectionStart = textareaRef.current.selectionEnd =
              selection.start.offset;
            handleSelectionChange?.();
          }
        }, 0);
      } catch (error) {
        console.error("Failed to cut text:", error);
      }
    }
  }, [content, onChange, updateBufferContent, activeBufferId, handleSelectionChange, textareaRef]);

  const handlePaste = useCallback(async () => {
    try {
      const text = await readText();
      if (textareaRef.current) {
        const cursorPos = textareaRef.current.selectionStart;
        const selection = useEditorStateStore.getState().selection;

        let newContent: string;
        let newCursorPos: number;

        if (selection && selection.start.offset !== selection.end.offset) {
          // Replace selection with pasted text
          newContent =
            content.slice(0, selection.start.offset) + text + content.slice(selection.end.offset);
          newCursorPos = selection.start.offset + text.length;
        } else {
          // Insert at cursor position
          newContent = content.slice(0, cursorPos) + text + content.slice(cursorPos);
          newCursorPos = cursorPos + text.length;
        }

        onChange?.(newContent);
        if (activeBufferId) {
          updateBufferContent(activeBufferId, newContent);
        }

        // Update cursor position
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.selectionStart = textareaRef.current.selectionEnd = newCursorPos;
            handleSelectionChange?.();
          }
        }, 0);
      }
    } catch (error) {
      console.error("Failed to paste text:", error);
    }
  }, [content, onChange, updateBufferContent, activeBufferId, handleSelectionChange, textareaRef]);

  return { handleCopy, handleCut, handlePaste };
}
