import { calculateOffsetFromPosition } from "@/utils/editor-position";
import { useEditorCursorStore } from "./editor-cursor-store";
import { useEditorViewStore } from "./editor-view-store";
import { useVimStore } from "./vim-store";

export interface VimNavigationCommands {
  moveLeft: () => void;
  moveRight: () => void;
  moveUp: () => void;
  moveDown: () => void;
  moveToLineStart: () => void;
  moveToLineEnd: () => void;
  moveToFileStart: () => void;
  moveToFileEnd: () => void;
  moveWordForward: () => void;
  moveWordBackward: () => void;
}

export const createVimNavigation = (): VimNavigationCommands => {
  const getCursorPosition = () => useEditorCursorStore.getState().cursorPosition;
  const setCursorPosition = (position: any) =>
    useEditorCursorStore.getState().actions.setCursorPosition(position);
  const getLines = () => useEditorViewStore.getState().lines;

  // Helper to update textarea cursor position
  const updateTextareaCursor = (newPosition: any, isVisualMode = false) => {
    const textarea = document.querySelector(".editor-textarea") as HTMLTextAreaElement;
    if (textarea) {
      if (isVisualMode) {
        const { visualSelection } = useVimStore.getState();
        if (visualSelection.start) {
          // In visual mode, maintain selection from start to current position
          const lines = useEditorViewStore.getState().lines;
          const startOffset = calculateOffsetFromPosition(
            visualSelection.start.line,
            visualSelection.start.column,
            lines,
          );
          textarea.selectionStart = startOffset;
          textarea.selectionEnd = newPosition.offset;
        } else {
          // Start visual selection from current position
          textarea.selectionStart = textarea.selectionEnd = newPosition.offset;
        }
      } else {
        // Normal mode - no selection
        textarea.selectionStart = textarea.selectionEnd = newPosition.offset;
      }
      // Trigger selection change to update the cursor store
      textarea.dispatchEvent(new Event("select"));
    }
  };

  // Helper to handle vim mode-aware movement
  const handleMovement = (newPosition: any) => {
    const vimState = useVimStore.getState();
    const isVisualMode = vimState.mode === "visual";

    setCursorPosition(newPosition);

    if (isVisualMode) {
      const { setVisualSelection } = useVimStore.getState().actions;

      if (!vimState.visualSelection.start) {
        // Start visual selection from current position
        setVisualSelection(
          { line: newPosition.line, column: newPosition.column },
          { line: newPosition.line, column: newPosition.column },
        );
      } else {
        // Update end of visual selection
        setVisualSelection(vimState.visualSelection.start, {
          line: newPosition.line,
          column: newPosition.column,
        });
      }
    }

    updateTextareaCursor(newPosition, isVisualMode);
  };

  return {
    moveLeft: () => {
      const currentPos = getCursorPosition();
      const lines = getLines();

      if (currentPos.column > 0) {
        // Move left within the line
        const newPosition = {
          line: currentPos.line,
          column: currentPos.column - 1,
          offset: currentPos.offset - 1,
        };
        handleMovement(newPosition);
      } else if (currentPos.line > 0) {
        // Move to end of previous line
        const prevLine = currentPos.line - 1;
        const newColumn = lines[prevLine].length;
        const newOffset = calculateOffsetFromPosition(prevLine, newColumn, lines);
        const newPosition = {
          line: prevLine,
          column: newColumn,
          offset: newOffset,
        };
        handleMovement(newPosition);
      }
    },

    moveRight: () => {
      const currentPos = getCursorPosition();
      const lines = getLines();

      if (currentPos.column < lines[currentPos.line].length) {
        // Move right within the line
        const newPosition = {
          line: currentPos.line,
          column: currentPos.column + 1,
          offset: currentPos.offset + 1,
        };
        handleMovement(newPosition);
      } else if (currentPos.line < lines.length - 1) {
        // Move to start of next line
        const nextLine = currentPos.line + 1;
        const newOffset = calculateOffsetFromPosition(nextLine, 0, lines);
        const newPosition = {
          line: nextLine,
          column: 0,
          offset: newOffset,
        };
        handleMovement(newPosition);
      }
    },

    moveUp: () => {
      const currentPos = getCursorPosition();
      const lines = getLines();

      if (currentPos.line > 0) {
        const targetLine = currentPos.line - 1;
        const targetColumn = Math.min(currentPos.column, lines[targetLine].length);
        const newOffset = calculateOffsetFromPosition(targetLine, targetColumn, lines);
        const newPosition = {
          line: targetLine,
          column: targetColumn,
          offset: newOffset,
        };
        handleMovement(newPosition);
      }
    },

    moveDown: () => {
      const currentPos = getCursorPosition();
      const lines = getLines();

      if (currentPos.line < lines.length - 1) {
        const targetLine = currentPos.line + 1;
        const targetColumn = Math.min(currentPos.column, lines[targetLine].length);
        const newOffset = calculateOffsetFromPosition(targetLine, targetColumn, lines);
        const newPosition = {
          line: targetLine,
          column: targetColumn,
          offset: newOffset,
        };
        handleMovement(newPosition);
      }
    },

    moveToLineStart: () => {
      const currentPos = getCursorPosition();
      const lines = getLines();

      const newOffset = calculateOffsetFromPosition(currentPos.line, 0, lines);
      const newPosition = {
        line: currentPos.line,
        column: 0,
        offset: newOffset,
      };
      handleMovement(newPosition);
    },

    moveToLineEnd: () => {
      const currentPos = getCursorPosition();
      const lines = getLines();

      const targetColumn = lines[currentPos.line].length;
      const newOffset = calculateOffsetFromPosition(currentPos.line, targetColumn, lines);
      const newPosition = {
        line: currentPos.line,
        column: targetColumn,
        offset: newOffset,
      };
      handleMovement(newPosition);
    },

    moveToFileStart: () => {
      const _lines = getLines();
      const newPosition = {
        line: 0,
        column: 0,
        offset: 0,
      };
      handleMovement(newPosition);
    },

    moveToFileEnd: () => {
      const lines = getLines();
      const lastLine = lines.length - 1;
      const lastColumn = lines[lastLine].length;
      const newOffset = calculateOffsetFromPosition(lastLine, lastColumn, lines);
      const newPosition = {
        line: lastLine,
        column: lastColumn,
        offset: newOffset,
      };
      handleMovement(newPosition);
    },

    moveWordForward: () => {
      const currentPos = getCursorPosition();
      const lines = getLines();
      const currentLineText = lines[currentPos.line];

      let newColumn = currentPos.column;
      let newLine = currentPos.line;

      // Skip current word
      while (newColumn < currentLineText.length && /\w/.test(currentLineText[newColumn])) {
        newColumn++;
      }

      // Skip whitespace
      while (newColumn < currentLineText.length && /\s/.test(currentLineText[newColumn])) {
        newColumn++;
      }

      // If at end of line, move to next line
      if (newColumn >= currentLineText.length && newLine < lines.length - 1) {
        newLine++;
        newColumn = 0;
      }

      const newOffset = calculateOffsetFromPosition(newLine, newColumn, lines);
      const newPosition = {
        line: newLine,
        column: newColumn,
        offset: newOffset,
      };
      handleMovement(newPosition);
    },

    moveWordBackward: () => {
      const currentPos = getCursorPosition();
      const lines = getLines();

      let newColumn = currentPos.column;
      let newLine = currentPos.line;

      if (newColumn > 0) {
        newColumn--;

        // Skip whitespace
        while (newColumn > 0 && /\s/.test(lines[newLine][newColumn])) {
          newColumn--;
        }

        // Skip current word
        while (newColumn > 0 && /\w/.test(lines[newLine][newColumn - 1])) {
          newColumn--;
        }
      } else if (newLine > 0) {
        // Move to end of previous line
        newLine--;
        newColumn = lines[newLine].length;
      }

      const newOffset = calculateOffsetFromPosition(newLine, newColumn, lines);
      const newPosition = {
        line: newLine,
        column: newColumn,
        offset: newOffset,
      };
      handleMovement(newPosition);
    },
  };
};
