import { useEditorCursorStore } from "@/stores/editor-cursor-store";
import { calculateOffsetFromPosition } from "@/utils/editor-position";

interface KeyboardShortcutParams {
  e: React.KeyboardEvent<HTMLTextAreaElement>;
  content: string;
  lines: string[];
  selectionStart: number;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onChange?: (value: string) => void;
  updateBufferContent: (bufferId: string, content: string) => void;
  activeBufferId: string | null;
  handleSelectionChange: () => void;
  handleCut: () => void;
}

export function handleKeyboardShortcuts({
  e,
  content,
  lines,
  selectionStart,
  textareaRef,
  onChange,
  updateBufferContent,
  activeBufferId,
  handleSelectionChange,
  handleCut,
}: KeyboardShortcutParams): boolean {
  if ((e.metaKey || e.ctrlKey) && e.key === "x") {
    e.preventDefault();
    const selection = useEditorCursorStore.getState().selection;

    if (!selection || selection.start.offset === selection.end.offset) {
      const lineStart = content.lastIndexOf("\n", selectionStart - 1) + 1;
      const lineEnd = content.indexOf("\n", selectionStart);
      const actualLineEnd = lineEnd === -1 ? content.length : lineEnd + 1;
      const lineContent = content.slice(lineStart, actualLineEnd);

      if (textareaRef.current) {
        textareaRef.current.selectionStart = lineStart;
        textareaRef.current.selectionEnd = actualLineEnd;

        navigator.clipboard.writeText(lineContent).catch(console.error);

        document.execCommand("insertText", false, "");

        handleSelectionChange();
      }
    } else {
      handleCut();
    }
    return true;
  }

  if (e.altKey && e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
    e.preventDefault();
    const selection = useEditorCursorStore.getState().selection;

    if (!selection || selection.start.offset === selection.end.offset) {
      const isUp = e.key === "ArrowUp";
      const currentLine = useEditorCursorStore.getState().cursorPosition.line;

      const lineStart = content.lastIndexOf("\n", selectionStart - 1) + 1;
      const lineEnd = content.indexOf("\n", selectionStart);
      const actualLineEnd = lineEnd === -1 ? content.length : lineEnd;
      const lineContent = content.slice(lineStart, actualLineEnd);

      let newContent: string;
      let newCursorLine: number;

      if (isUp) {
        newContent = `${content.slice(0, lineStart)}${lineContent}\n${lineContent}${content.slice(actualLineEnd)}`;
        newCursorLine = currentLine;
      } else {
        newContent = `${content.slice(0, actualLineEnd)}\n${lineContent}${content.slice(actualLineEnd)}`;
        newCursorLine = currentLine + 1;
      }

      const newOffset = calculateOffsetFromPosition(
        newCursorLine,
        useEditorCursorStore.getState().cursorPosition.column,
        newContent.split("\n"),
      );

      if (textareaRef.current) {
        textareaRef.current.value = newContent;
        textareaRef.current.selectionStart = textareaRef.current.selectionEnd = newOffset;

        const inputEvent = new Event("input", { bubbles: true });
        textareaRef.current.dispatchEvent(inputEvent);

        handleSelectionChange();
      }

      onChange?.(newContent);
      if (activeBufferId) {
        updateBufferContent(activeBufferId, newContent);
      }
    }
    return true;
  }

  if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
    e.preventDefault();
    const selection = useEditorCursorStore.getState().selection;
    const currentPosition = useEditorCursorStore.getState().cursorPosition;

    if (!selection || selection.start.offset === selection.end.offset) {
      const isUp = e.key === "ArrowUp";
      const currentLine = currentPosition.line;
      const targetLine = isUp ? currentLine - 1 : currentLine + 1;

      if (targetLine < 0 || targetLine >= lines.length) return true;

      const currentLineContent = lines[currentLine];
      const targetLineContent = lines[targetLine];

      const newLines = [...lines];
      newLines[currentLine] = targetLineContent;
      newLines[targetLine] = currentLineContent;

      const newContent = newLines.join("\n");
      const newCursorPosition = { ...currentPosition, line: targetLine };
      const newOffset = calculateOffsetFromPosition(
        newCursorPosition.line,
        newCursorPosition.column,
        newLines,
      );

      if (textareaRef.current) {
        textareaRef.current.value = newContent;
        textareaRef.current.selectionStart = textareaRef.current.selectionEnd = newOffset;

        const inputEvent = new Event("input", { bubbles: true });
        textareaRef.current.dispatchEvent(inputEvent);

        handleSelectionChange();
      }

      onChange?.(newContent);
      if (activeBufferId) {
        updateBufferContent(activeBufferId, newContent);
      }
    }
    return true;
  }

  if ((e.metaKey || e.ctrlKey) && e.key === "d") {
    e.preventDefault();
    const selection = useEditorCursorStore.getState().selection;

    if (!selection || selection.start.offset === selection.end.offset) {
      const lineStart = content.lastIndexOf("\n", selectionStart - 1) + 1;
      const lineEnd = content.indexOf("\n", selectionStart);
      const actualLineEnd = lineEnd === -1 ? content.length : lineEnd;
      const lineContent = content.slice(lineStart, actualLineEnd);

      const newContent = `${content.slice(0, actualLineEnd)}\n${lineContent}${content.slice(actualLineEnd)}`;
      const newOffset = selectionStart + lineContent.length + 1;

      if (textareaRef.current) {
        textareaRef.current.value = newContent;
        textareaRef.current.selectionStart = textareaRef.current.selectionEnd = newOffset;

        const inputEvent = new Event("input", { bubbles: true });
        textareaRef.current.dispatchEvent(inputEvent);

        handleSelectionChange();
      }

      onChange?.(newContent);
      if (activeBufferId) {
        updateBufferContent(activeBufferId, newContent);
      }
    }
    return true;
  }

  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "K") {
    e.preventDefault();
    const selection = useEditorCursorStore.getState().selection;

    if (!selection || selection.start.offset === selection.end.offset) {
      const lineStart = content.lastIndexOf("\n", selectionStart - 1) + 1;
      const lineEnd = content.indexOf("\n", selectionStart);
      const actualLineEnd = lineEnd === -1 ? content.length : lineEnd + 1;

      const newContent = content.slice(0, lineStart) + content.slice(actualLineEnd);

      if (textareaRef.current) {
        textareaRef.current.value = newContent;
        textareaRef.current.selectionStart = textareaRef.current.selectionEnd = lineStart;

        const inputEvent = new Event("input", { bubbles: true });
        textareaRef.current.dispatchEvent(inputEvent);

        handleSelectionChange();
      }

      onChange?.(newContent);
      if (activeBufferId) {
        updateBufferContent(activeBufferId, newContent);
      }
    }
    return true;
  }

  if ((e.metaKey || e.ctrlKey) && e.key === "/") {
    e.preventDefault();
    const selection = useEditorCursorStore.getState().selection;

    if (!selection || selection.start.offset === selection.end.offset) {
      const lineStart = content.lastIndexOf("\n", selectionStart - 1) + 1;
      const lineEnd = content.indexOf("\n", selectionStart);
      const actualLineEnd = lineEnd === -1 ? content.length : lineEnd;
      const lineContent = content.slice(lineStart, actualLineEnd);

      const isCommented = lineContent.trim().startsWith("//");
      const newLineContent = isCommented
        ? lineContent.replace(/^\s*\/\/\s?/, (match) => match.slice(0, -2).slice(0, -1) || "")
        : lineContent.replace(/^(\s*)/, "$1// ");

      const newContent =
        content.slice(0, lineStart) + newLineContent + content.slice(actualLineEnd);

      if (textareaRef.current) {
        textareaRef.current.value = newContent;
        const inputEvent = new Event("input", { bubbles: true });
        textareaRef.current.dispatchEvent(inputEvent);
        handleSelectionChange();
      }

      onChange?.(newContent);
      if (activeBufferId) {
        updateBufferContent(activeBufferId, newContent);
      }
    }
    return true;
  }

  return false;
}
