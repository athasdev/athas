import { calculateOffsetFromPosition } from "@/utils/editor-position";
import { useBufferStore } from "./buffer-store";
import { useEditorCursorStore } from "./editor-cursor-store";
import { useEditorViewStore } from "./editor-view-store";

interface VimClipboard {
  content: string;
  type: "line" | "char";
}

let vimClipboard: VimClipboard = { content: "", type: "char" };
const undoStack: string[] = [];
const redoStack: string[] = [];

export interface VimEditingCommands {
  deleteLine: () => void;
  yankLine: () => void;
  paste: (content?: string, type?: "line" | "char") => void;
  pasteAbove: (content?: string, type?: "line" | "char") => void;
  undo: () => void;
  redo: () => void;
  deleteChar: () => void;
  deleteCharBefore: () => void;
  replaceChar: (char: string) => void;
  substituteChar: () => void;
  openLineBelow: () => void;
  openLineAbove: () => void;
  appendToLine: () => void;
  insertAtLineStart: () => void;
  deleteVisualSelection: (startOffset: number, endOffset: number) => void;
  yankVisualSelection: (startOffset: number, endOffset: number) => void;
}

export const createVimEditing = (): VimEditingCommands => {
  const getCursorPosition = () => useEditorCursorStore.getState().cursorPosition;
  const setCursorPosition = (position: any) =>
    useEditorCursorStore.getState().actions.setCursorPosition(position);
  const getLines = () => useEditorViewStore.getState().lines;
  const getContent = () => useEditorViewStore.getState().actions.getContent();

  // Get active buffer info
  const _getActiveBuffer = () => {
    const { buffers, activeBufferId } = useBufferStore.getState();
    return buffers.find((b) => b.id === activeBufferId);
  };

  // Update buffer content
  const updateContent = (newContent: string) => {
    const { actions, activeBufferId } = useBufferStore.getState();
    if (activeBufferId) {
      actions.updateBufferContent(activeBufferId, newContent);

      // Update textarea
      const textarea = document.querySelector(".editor-textarea") as HTMLTextAreaElement;
      if (textarea) {
        textarea.value = newContent;
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  };

  // Save state for undo
  const saveUndoState = () => {
    const currentContent = getContent();
    undoStack.push(currentContent);
    redoStack.length = 0; // Clear redo stack when new action is performed

    // Limit undo stack size
    if (undoStack.length > 100) {
      undoStack.shift();
    }
  };

  // Update textarea cursor position
  const updateTextareaCursor = (newPosition: any) => {
    const textarea = document.querySelector(".editor-textarea") as HTMLTextAreaElement;
    if (textarea) {
      textarea.selectionStart = textarea.selectionEnd = newPosition.offset;
      textarea.dispatchEvent(new Event("select"));
    }
  };

  return {
    deleteLine: () => {
      saveUndoState();

      const currentPos = getCursorPosition();
      const lines = getLines();

      if (lines.length <= 1) {
        // If only one line, just clear it
        vimClipboard = { content: `${lines[0]}\n`, type: "line" };
        updateContent("");
        setCursorPosition({ line: 0, column: 0, offset: 0 });
        updateTextareaCursor({ line: 0, column: 0, offset: 0 });
        return;
      }

      // Save deleted line to clipboard
      vimClipboard = { content: `${lines[currentPos.line]}\n`, type: "line" };

      // Remove the line
      const newLines = lines.filter((_, index) => index !== currentPos.line);
      const newContent = newLines.join("\n");

      // Adjust cursor position
      const newLine = Math.min(currentPos.line, newLines.length - 1);
      const newColumn = Math.min(currentPos.column, newLines[newLine].length);
      const newOffset = calculateOffsetFromPosition(newLine, newColumn, newLines);

      updateContent(newContent);
      const newPosition = { line: newLine, column: newColumn, offset: newOffset };
      setCursorPosition(newPosition);
      updateTextareaCursor(newPosition);
    },

    yankLine: () => {
      const currentPos = getCursorPosition();
      const lines = getLines();

      // Copy current line to clipboard
      vimClipboard = { content: `${lines[currentPos.line]}\n`, type: "line" };
    },

    paste: (content?: string, type?: "line" | "char") => {
      // Use provided content or fall back to vimClipboard
      const pasteContent = content ?? vimClipboard.content;
      const pasteType = type ?? vimClipboard.type;

      if (!pasteContent) return;

      saveUndoState();

      const currentPos = getCursorPosition();
      const lines = getLines();

      if (pasteType === "line") {
        // Paste as new line below current line
        const newLines = [...lines];
        newLines.splice(currentPos.line + 1, 0, pasteContent.replace(/\n$/, ""));
        const newContent = newLines.join("\n");

        // Move cursor to beginning of pasted line
        const newLine = currentPos.line + 1;
        const newOffset = calculateOffsetFromPosition(newLine, 0, newLines);

        updateContent(newContent);
        const newPosition = { line: newLine, column: 0, offset: newOffset };
        setCursorPosition(newPosition);
        updateTextareaCursor(newPosition);
      } else {
        // Paste as character content at cursor
        const currentContent = getContent();
        const newContent =
          currentContent.slice(0, currentPos.offset) +
          pasteContent +
          currentContent.slice(currentPos.offset);

        updateContent(newContent);

        // Move cursor to end of pasted content
        const newOffset = currentPos.offset + pasteContent.length;
        const newLines = newContent.split("\n");
        let line = 0;
        let offset = 0;

        while (offset + newLines[line].length + 1 <= newOffset && line < newLines.length - 1) {
          offset += newLines[line].length + 1;
          line++;
        }

        const column = newOffset - offset;
        const newPosition = { line, column, offset: newOffset };
        setCursorPosition(newPosition);
        updateTextareaCursor(newPosition);
      }
    },

    pasteAbove: (content?: string, type?: "line" | "char") => {
      // Use provided content or fall back to vimClipboard
      const pasteContent = content ?? vimClipboard.content;
      const pasteType = type ?? vimClipboard.type;

      if (!pasteContent || pasteType !== "line") return;

      saveUndoState();

      const currentPos = getCursorPosition();
      const lines = getLines();

      // Paste as new line above current line
      const newLines = [...lines];
      newLines.splice(currentPos.line, 0, pasteContent.replace(/\n$/, ""));
      const newContent = newLines.join("\n");

      // Move cursor to beginning of pasted line
      const newOffset = calculateOffsetFromPosition(currentPos.line, 0, newLines);

      updateContent(newContent);
      const newPosition = { line: currentPos.line, column: 0, offset: newOffset };
      setCursorPosition(newPosition);
      updateTextareaCursor(newPosition);
    },

    undo: () => {
      if (undoStack.length === 0) return;

      const currentContent = getContent();
      const previousContent = undoStack.pop()!;

      // Save current state to redo stack
      redoStack.push(currentContent);

      updateContent(previousContent);

      // Try to maintain cursor position
      const currentPos = getCursorPosition();
      const newLines = previousContent.split("\n");
      const newLine = Math.min(currentPos.line, newLines.length - 1);
      const newColumn = Math.min(currentPos.column, newLines[newLine].length);
      const newOffset = calculateOffsetFromPosition(newLine, newColumn, newLines);

      const newPosition = { line: newLine, column: newColumn, offset: newOffset };
      setCursorPosition(newPosition);
      updateTextareaCursor(newPosition);
    },

    redo: () => {
      if (redoStack.length === 0) return;

      const currentContent = getContent();
      const nextContent = redoStack.pop()!;

      // Save current state to undo stack
      undoStack.push(currentContent);

      updateContent(nextContent);

      // Try to maintain cursor position
      const currentPos = getCursorPosition();
      const newLines = nextContent.split("\n");
      const newLine = Math.min(currentPos.line, newLines.length - 1);
      const newColumn = Math.min(currentPos.column, newLines[newLine].length);
      const newOffset = calculateOffsetFromPosition(newLine, newColumn, newLines);

      const newPosition = { line: newLine, column: newColumn, offset: newOffset };
      setCursorPosition(newPosition);
      updateTextareaCursor(newPosition);
    },

    deleteChar: () => {
      saveUndoState();

      const currentPos = getCursorPosition();
      const currentContent = getContent();

      if (currentPos.offset < currentContent.length) {
        const deletedChar = currentContent[currentPos.offset];
        vimClipboard = { content: deletedChar, type: "char" };

        const newContent =
          currentContent.slice(0, currentPos.offset) + currentContent.slice(currentPos.offset + 1);

        updateContent(newContent);

        // Recalculate cursor position with new content
        const newLines = newContent.split("\n");
        const newLine = Math.min(currentPos.line, newLines.length - 1);
        const newColumn = Math.min(currentPos.column, newLines[newLine]?.length ?? 0);
        const newOffset = calculateOffsetFromPosition(newLine, newColumn, newLines);

        const newPosition = { line: newLine, column: newColumn, offset: newOffset };
        setCursorPosition(newPosition);
        updateTextareaCursor(newPosition);
      }
    },

    deleteCharBefore: () => {
      saveUndoState();

      const currentPos = getCursorPosition();
      const currentContent = getContent();

      if (currentPos.offset > 0) {
        const deletedChar = currentContent[currentPos.offset - 1];
        vimClipboard = { content: deletedChar, type: "char" };

        const newContent =
          currentContent.slice(0, currentPos.offset - 1) + currentContent.slice(currentPos.offset);

        updateContent(newContent);

        // Move cursor back one position
        const newPosition = {
          line: currentPos.line,
          column: Math.max(0, currentPos.column - 1),
          offset: currentPos.offset - 1,
        };
        setCursorPosition(newPosition);
        updateTextareaCursor(newPosition);
      }
    },

    replaceChar: (char: string) => {
      saveUndoState();

      const currentPos = getCursorPosition();
      const currentContent = getContent();

      if (currentPos.offset < currentContent.length) {
        // Replace character at cursor with new character
        const newContent =
          currentContent.slice(0, currentPos.offset) +
          char +
          currentContent.slice(currentPos.offset + 1);

        updateContent(newContent);
        // Cursor position stays the same - update both store and textarea
        setCursorPosition(currentPos);
        updateTextareaCursor(currentPos);
      }
    },

    substituteChar: () => {
      saveUndoState();

      const currentPos = getCursorPosition();
      const currentContent = getContent();

      if (currentPos.offset < currentContent.length) {
        const deletedChar = currentContent[currentPos.offset];
        vimClipboard = { content: deletedChar, type: "char" };

        // Delete character and enter insert mode
        const newContent =
          currentContent.slice(0, currentPos.offset) + currentContent.slice(currentPos.offset + 1);

        updateContent(newContent);
        updateTextareaCursor(currentPos);
      }
    },

    openLineBelow: () => {
      saveUndoState();

      const currentPos = getCursorPosition();
      const lines = getLines();

      // Add new empty line below current line
      const newLines = [...lines];
      newLines.splice(currentPos.line + 1, 0, "");
      const newContent = newLines.join("\n");

      // Move cursor to beginning of new line
      const newLine = currentPos.line + 1;
      const newOffset = calculateOffsetFromPosition(newLine, 0, newLines);

      updateContent(newContent);
      const newPosition = { line: newLine, column: 0, offset: newOffset };
      setCursorPosition(newPosition);
      updateTextareaCursor(newPosition);
    },

    openLineAbove: () => {
      saveUndoState();

      const currentPos = getCursorPosition();
      const lines = getLines();

      // Add new empty line above current line
      const newLines = [...lines];
      newLines.splice(currentPos.line, 0, "");
      const newContent = newLines.join("\n");

      // Move cursor to beginning of new line (same line number since we inserted above)
      const newOffset = calculateOffsetFromPosition(currentPos.line, 0, newLines);

      updateContent(newContent);
      const newPosition = { line: currentPos.line, column: 0, offset: newOffset };
      setCursorPosition(newPosition);
      updateTextareaCursor(newPosition);
    },

    appendToLine: () => {
      const currentPos = getCursorPosition();
      const lines = getLines();

      // Move cursor to end of current line
      const targetColumn = lines[currentPos.line].length;
      const newOffset = calculateOffsetFromPosition(currentPos.line, targetColumn, lines);
      const newPosition = { line: currentPos.line, column: targetColumn, offset: newOffset };
      setCursorPosition(newPosition);
      updateTextareaCursor(newPosition);
    },

    insertAtLineStart: () => {
      const currentPos = getCursorPosition();
      const lines = getLines();

      // Move cursor to start of current line (after any indentation)
      const currentLine = lines[currentPos.line];
      let firstNonWhitespace = 0;
      while (
        firstNonWhitespace < currentLine.length &&
        /\s/.test(currentLine[firstNonWhitespace])
      ) {
        firstNonWhitespace++;
      }

      const targetColumn = firstNonWhitespace;
      const newOffset = calculateOffsetFromPosition(currentPos.line, targetColumn, lines);
      const newPosition = { line: currentPos.line, column: targetColumn, offset: newOffset };
      setCursorPosition(newPosition);
      updateTextareaCursor(newPosition);
    },

    deleteVisualSelection: (startOffset: number, endOffset: number) => {
      saveUndoState();

      const currentContent = getContent();
      const start = Math.min(startOffset, endOffset);
      const end = Math.max(startOffset, endOffset);

      // Save deleted content to clipboard
      const deletedContent = currentContent.slice(start, end);
      vimClipboard = { content: deletedContent, type: "char" };

      // Delete the selection
      const newContent = currentContent.slice(0, start) + currentContent.slice(end);
      updateContent(newContent);

      // Move cursor to start of deleted selection
      const newLines = newContent.split("\n");
      let line = 0;
      let offset = 0;

      while (offset + newLines[line].length + 1 <= start && line < newLines.length - 1) {
        offset += newLines[line].length + 1;
        line++;
      }

      const column = start - offset;
      const newPosition = { line, column, offset: start };
      setCursorPosition(newPosition);
      updateTextareaCursor(newPosition);
    },

    yankVisualSelection: (startOffset: number, endOffset: number) => {
      const currentContent = getContent();
      const start = Math.min(startOffset, endOffset);
      const end = Math.max(startOffset, endOffset);

      // Copy selected content to clipboard
      const selectedContent = currentContent.slice(start, end);
      vimClipboard = { content: selectedContent, type: "char" };
    },
  };
};
