import { useEffect } from "react";
import { useSettingsStore } from "@/settings/store";
import { useEditorCursorStore } from "@/stores/editor-cursor-store";
import { useEditorInstanceStore } from "@/stores/editor-instance-store";
import { useEditorViewStore } from "@/stores/editor-view-store";
import { executeVimCommand } from "@/stores/vim";
import { expectsMoreKeys, isCommandComplete } from "@/stores/vim/core/command-parser";
import { isMotion } from "@/stores/vim/core/motion-registry";
import { isOperator } from "@/stores/vim/operators";
import { createVimEditing } from "@/stores/vim-editing";
import { createVimNavigation } from "@/stores/vim-navigation";
import { useVimSearchStore } from "@/stores/vim-search";
import { useVimStore } from "@/stores/vim-store";
import { calculateOffsetFromPosition } from "@/utils/editor-position";

interface UseVimKeyboardProps {
  onSave?: () => void;
  onGoToLine?: (line: number) => void;
}

export const useVimKeyboard = ({ onSave, onGoToLine }: UseVimKeyboardProps) => {
  const { settings } = useSettingsStore();
  const vimMode = settings.vimMode;
  const mode = useVimStore.use.mode();
  const isCommandMode = useVimStore.use.isCommandMode();
  const lastKey = useVimStore.use.lastKey();
  const {
    setMode,
    enterCommandMode,
    exitCommandMode,
    isCapturingInput,
    reset,
    setLastKey,
    clearLastKey,
    addToKeyBuffer,
    clearKeyBuffer,
    getKeyBuffer,
    setVisualMode,
  } = useVimStore.use.actions();
  const { setCursorVisibility, setCursorPosition } = useEditorCursorStore.use.actions();
  const { setDisabled } = useEditorInstanceStore.use.actions();
  const { startSearch, findNext, findPrevious } = useVimSearchStore.use.actions();

  // Helper functions for accessing editor state
  const getCursorPosition = () => useEditorCursorStore.getState().cursorPosition;
  const getLines = () => useEditorViewStore.getState().lines;

  // Reset vim state when vim mode is enabled/disabled
  useEffect(() => {
    if (vimMode) {
      reset(); // Ensure clean state when vim mode is enabled
    }
  }, [vimMode, reset]);

  // Control editor state based on vim mode
  useEffect(() => {
    if (!vimMode) {
      // When vim mode is off, ensure editor is enabled
      setDisabled(false);
      setCursorVisibility(true);

      const textarea = document.querySelector(".editor-textarea") as HTMLTextAreaElement | null;
      if (textarea) {
        textarea.readOnly = false;
        textarea.removeAttribute("data-vim-mode");
        textarea.removeAttribute("readonly");
      }

      document.body.classList.remove(
        "vim-mode-normal",
        "vim-mode-insert",
        "vim-mode-visual",
        "vim-mode-command",
      );
      return;
    }

    // In vim mode:
    // - Insert mode: allow typing (enabled)
    // - Normal/Visual modes: keep textarea read-only but enabled for navigation
    // - Command mode: disable editor, command bar handles input
    const shouldDisableEditor = isCommandMode;
    const shouldReadOnly = mode !== "insert";
    const shouldShowCursor = true; // Always show cursor in vim mode

    setDisabled(shouldDisableEditor);
    setCursorVisibility(shouldShowCursor);

    // Update textarea data attributes for CSS styling
    const textarea = document.querySelector(".editor-textarea") as HTMLTextAreaElement;
    if (textarea) {
      const vimModeAttr = isCommandMode ? "command" : mode;
      textarea.setAttribute("data-vim-mode", vimModeAttr);
      textarea.readOnly = shouldReadOnly;
      if (!shouldReadOnly) {
        textarea.removeAttribute("readonly");
      }

      // Add body class for global vim mode styling
      document.body.classList.remove(
        "vim-mode-normal",
        "vim-mode-insert",
        "vim-mode-visual",
        "vim-mode-command",
      );
      document.body.classList.add(`vim-mode-${vimModeAttr}`);
    }
  }, [vimMode, mode, isCommandMode, setCursorVisibility, setDisabled]);

  useEffect(() => {
    // Only activate vim keyboard handling when vim mode is enabled
    if (!vimMode) return;

    // Create vim navigation and editing commands
    const vimNav = createVimNavigation();
    const vimEdit = createVimEditing();

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInputField =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      // Special handling for code editor textarea
      const isCodeEditor =
        target.tagName === "TEXTAREA" && target.classList.contains("editor-textarea");

      // Allow keyboard shortcuts with modifiers (Cmd/Ctrl/Alt) to pass through
      // Exception: Ctrl+r is vim redo
      if (
        (e.metaKey || e.ctrlKey || e.altKey) &&
        !(e.ctrlKey && e.key === "r" && !e.metaKey && !e.altKey)
      ) {
        return;
      }

      if (isCodeEditor) {
        // In code editor, vim mode takes precedence
        // Let vim handle all keys when vim mode is active
      } else if (isInputField && !isCommandMode) {
        // For other input fields, only handle escape
        if (e.key === "Escape" && mode === "insert") {
          e.preventDefault();
          setMode("normal");
        }
        return;
      }

      // Handle vim commands based on current mode
      let handled = false;
      switch (mode) {
        case "normal":
          handled = handleNormalMode(e) || false;
          break;
        case "insert":
          handled = handleInsertMode(e) || false;
          break;
        case "visual":
          handled = handleVisualMode(e) || false;
          break;
        case "command":
          // Command mode is handled by the vim command bar component
          break;
      }

      // If vim mode handled the key, stop further processing
      if (handled) {
        return;
      }
    };

    const handleNormalMode = (e: KeyboardEvent) => {
      // Don't handle if we're capturing input in command mode
      if (isCapturingInput()) return;

      const key = e.key;

      // Handle special commands that don't fit the operator-motion pattern
      // These commands are handled directly without going through the key buffer
      switch (key) {
        case "i":
          e.preventDefault();
          e.stopPropagation();
          clearKeyBuffer();
          setMode("insert");
          return true;
        case "a": {
          e.preventDefault();
          e.stopPropagation();
          clearKeyBuffer();
          // Move cursor one position right before entering insert mode
          const currentPos = getCursorPosition();
          const lines = getLines();
          const newColumn = Math.min(lines[currentPos.line].length, currentPos.column + 1);
          const newOffset = calculateOffsetFromPosition(currentPos.line, newColumn, lines);
          const newPosition = { line: currentPos.line, column: newColumn, offset: newOffset };
          setCursorPosition(newPosition);

          // Update textarea cursor
          const textarea = document.querySelector(".editor-textarea") as HTMLTextAreaElement;
          if (textarea) {
            textarea.selectionStart = textarea.selectionEnd = newOffset;
          }

          setMode("insert");
          return true;
        }
        case "A":
          e.preventDefault();
          e.stopPropagation();
          clearKeyBuffer();
          vimEdit.appendToLine();
          setMode("insert");
          return true;
        case "I":
          e.preventDefault();
          e.stopPropagation();
          clearKeyBuffer();
          vimEdit.insertAtLineStart();
          setMode("insert");
          return true;
        case "o":
          e.preventDefault();
          e.stopPropagation();
          clearKeyBuffer();
          vimEdit.openLineBelow();
          setMode("insert");
          return true;
        case "O":
          e.preventDefault();
          e.stopPropagation();
          clearKeyBuffer();
          vimEdit.openLineAbove();
          setMode("insert");
          return true;
        case ":":
          e.preventDefault();
          e.stopPropagation();
          clearKeyBuffer();
          enterCommandMode();
          return true;
        case "v": {
          e.preventDefault();
          e.stopPropagation();
          clearKeyBuffer();
          const currentPos = useEditorCursorStore.getState().cursorPosition;
          const { setVisualSelection } = useVimStore.use.actions();
          setVisualSelection(
            { line: currentPos.line, column: currentPos.column },
            { line: currentPos.line, column: currentPos.column },
          );
          setVisualMode("char");
          setMode("visual");

          // Initialize textarea selection at current position
          const textarea = document.querySelector(".editor-textarea") as HTMLTextAreaElement;
          if (textarea) {
            textarea.selectionStart = textarea.selectionEnd = currentPos.offset;
            textarea.focus();
          }

          return true;
        }
        case "V": {
          e.preventDefault();
          e.stopPropagation();
          clearKeyBuffer();
          const currentPos = useEditorCursorStore.getState().cursorPosition;
          const lines = useEditorViewStore.getState().lines;
          const { setVisualSelection } = useVimStore.use.actions();
          setVisualSelection(
            { line: currentPos.line, column: 0 },
            { line: currentPos.line, column: lines[currentPos.line].length },
          );
          setVisualMode("line");
          setMode("visual");

          // Initialize textarea selection for the whole line
          const textarea = document.querySelector(".editor-textarea") as HTMLTextAreaElement;
          if (textarea) {
            const startOffset = calculateOffsetFromPosition(currentPos.line, 0, lines);
            const endOffset = calculateOffsetFromPosition(
              currentPos.line,
              lines[currentPos.line].length,
              lines,
            );
            textarea.selectionStart = startOffset;
            textarea.selectionEnd = endOffset;
            textarea.focus();
          }

          return true;
        }
        case "Escape":
          e.preventDefault();
          e.stopPropagation();
          clearKeyBuffer();
          setMode("normal");
          return true;
        case "p":
          e.preventDefault();
          e.stopPropagation();
          clearKeyBuffer();
          vimEdit.paste();
          return true;
        case "P":
          e.preventDefault();
          e.stopPropagation();
          clearKeyBuffer();
          vimEdit.pasteAbove();
          return true;
        case "u":
          e.preventDefault();
          e.stopPropagation();
          clearKeyBuffer();
          vimEdit.undo();
          return true;
        case "r":
          if (e.ctrlKey) {
            e.preventDefault();
            e.stopPropagation();
            clearKeyBuffer();
            vimEdit.redo();
            return true;
          }
          // Wait for next character for replace
          e.preventDefault();
          e.stopPropagation();
          setLastKey("r");
          return true;
        case "s":
          e.preventDefault();
          e.stopPropagation();
          clearKeyBuffer();
          vimEdit.substituteChar();
          setMode("insert");
          return true;
        case "x":
          e.preventDefault();
          e.stopPropagation();
          clearKeyBuffer();
          vimEdit.deleteChar();
          return true;
        case "X":
          e.preventDefault();
          e.stopPropagation();
          clearKeyBuffer();
          vimEdit.deleteCharBefore();
          return true;
        case "/":
          e.preventDefault();
          e.stopPropagation();
          clearKeyBuffer();
          startSearch();
          return true;
        case "n":
          e.preventDefault();
          e.stopPropagation();
          clearKeyBuffer();
          findNext();
          return true;
        case "N":
          e.preventDefault();
          e.stopPropagation();
          clearKeyBuffer();
          findPrevious();
          return true;
        case "g":
          e.preventDefault();
          e.stopPropagation();
          if (lastKey === "g") {
            vimNav.moveToFileStart();
            clearLastKey();
            clearKeyBuffer();
          } else {
            setLastKey("g");
          }
          return true;
        case "G":
          e.preventDefault();
          e.stopPropagation();
          clearKeyBuffer();
          vimNav.moveToFileEnd();
          return true;
      }

      // Handle double-key commands (dd, yy) and character replacement (r{char})
      if (key === "d" && lastKey === "d") {
        e.preventDefault();
        e.stopPropagation();
        vimEdit.deleteLine();
        clearLastKey();
        clearKeyBuffer();
        return true;
      }
      if (key === "y" && lastKey === "y") {
        e.preventDefault();
        e.stopPropagation();
        vimEdit.yankLine();
        clearLastKey();
        clearKeyBuffer();
        return true;
      }
      if (lastKey === "r" && key.length === 1) {
        // Replace character with the pressed key
        e.preventDefault();
        e.stopPropagation();
        vimEdit.replaceChar(key);
        clearLastKey();
        clearKeyBuffer();
        return true;
      }

      // Now handle vim command sequences with the new modular system
      // This supports: [count][operator][count][motion/text-object]
      // Examples: 3j, 5w, d3w, 3dw, ciw, di", etc.

      // Check if this is a valid vim command key
      const isDigit = /^[0-9]$/.test(key);
      const isTextObjectModifier = key === "i" || key === "a";
      const buffer = getKeyBuffer();

      // Determine if this key can be part of a vim command
      const canBePartOfCommand =
        isDigit ||
        isOperator(key) ||
        isMotion(key) ||
        (isTextObjectModifier && buffer.length > 0 && isOperator(buffer[buffer.length - 1]));

      if (!canBePartOfCommand) {
        // Not a vim command, clear buffer and let it pass through
        if (buffer.length > 0) {
          clearKeyBuffer();
        }
        return false;
      }

      // Add key to buffer
      e.preventDefault();
      e.stopPropagation();
      addToKeyBuffer(key);

      const newBuffer = getKeyBuffer();

      // Check if we have a complete command
      if (isCommandComplete(newBuffer)) {
        // Execute the command
        const success = executeVimCommand(newBuffer);
        clearKeyBuffer();

        if (!success) {
          console.warn("Failed to execute vim command:", newBuffer.join(""));
        }
        return true;
      }

      // Check if we should wait for more keys
      if (expectsMoreKeys(newBuffer)) {
        // Wait for more keys
        return true;
      }

      // Invalid command, clear buffer
      clearKeyBuffer();
      return false;
    };

    const handleInsertMode = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setMode("normal");
        return true;
      }
      // In insert mode, let most keys pass through to the editor
      return false;
    };

    const handleVisualMode = (e: KeyboardEvent) => {
      const key = e.key;
      const visualMode = useVimStore.getState().visualMode;
      const visualSelection = useVimStore.getState().visualSelection;

      switch (key) {
        case "Escape":
          e.preventDefault();
          e.stopPropagation();
          setMode("normal");
          return true;
        case ":":
          e.preventDefault();
          e.stopPropagation();
          enterCommandMode();
          return true;
        case "d":
        case "y":
        case "c": {
          e.preventDefault();
          e.stopPropagation();
          // Handle operators on visual selection
          const textarea = document.querySelector(".editor-textarea") as HTMLTextAreaElement;
          if (textarea && visualSelection.start && visualSelection.end) {
            const lines = useEditorViewStore.getState().lines;
            const startOffset = calculateOffsetFromPosition(
              visualSelection.start.line,
              visualSelection.start.column,
              lines,
            );
            const endOffset = calculateOffsetFromPosition(
              visualSelection.end.line,
              visualSelection.end.column,
              lines,
            );

            if (key === "d") {
              vimEdit.deleteVisualSelection(startOffset, endOffset);
            } else if (key === "y") {
              vimEdit.yankVisualSelection(startOffset, endOffset);
            } else if (key === "c") {
              vimEdit.deleteVisualSelection(startOffset, endOffset);
              setMode("insert");
              return true;
            }
          }
          setMode("normal");
          return true;
        }
      }

      // Movement keys in visual mode extend selection
      const isMovementKey =
        key === "h" ||
        key === "j" ||
        key === "k" ||
        key === "l" ||
        key === "w" ||
        key === "b" ||
        key === "e" ||
        key === "0" ||
        key === "$" ||
        key === "ArrowLeft" ||
        key === "ArrowRight" ||
        key === "ArrowUp" ||
        key === "ArrowDown";

      if (isMovementKey) {
        e.preventDefault();
        e.stopPropagation();

        // Get current cursor position
        const currentPos = useEditorCursorStore.getState().cursorPosition;
        const lines = useEditorViewStore.getState().lines;

        // Execute the motion to get new cursor position
        let newLine = currentPos.line;
        let newColumn = currentPos.column;

        switch (key) {
          case "h":
          case "ArrowLeft":
            newColumn = Math.max(0, currentPos.column - 1);
            break;
          case "l":
          case "ArrowRight":
            newColumn = Math.min(lines[currentPos.line].length, currentPos.column + 1);
            break;
          case "j":
          case "ArrowDown":
            newLine = Math.min(lines.length - 1, currentPos.line + 1);
            newColumn = Math.min(lines[newLine].length, currentPos.column);
            break;
          case "k":
          case "ArrowUp":
            newLine = Math.max(0, currentPos.line - 1);
            newColumn = Math.min(lines[newLine].length, currentPos.column);
            break;
          case "w":
            vimNav.moveWordForward();
            return true;
          case "b":
            vimNav.moveWordBackward();
            return true;
          case "e":
            vimNav.moveWordEnd();
            return true;
          case "0":
            newColumn = 0;
            break;
          case "$":
            newColumn = lines[currentPos.line].length;
            break;
        }

        // Update cursor position
        const newOffset = calculateOffsetFromPosition(newLine, newColumn, lines);
        useEditorCursorStore.getState().actions.setCursorPosition({
          line: newLine,
          column: newColumn,
          offset: newOffset,
        });

        // Update visual selection end
        const { setVisualSelection } = useVimStore.use.actions();
        if (visualSelection.start) {
          if (visualMode === "line") {
            // Line mode: select entire lines
            setVisualSelection(
              { line: visualSelection.start.line, column: 0 },
              { line: newLine, column: lines[newLine].length },
            );
          } else {
            // Character mode: select characters
            setVisualSelection(visualSelection.start, { line: newLine, column: newColumn });
          }
        }

        // Update textarea selection to show visual highlighting
        const textarea = document.querySelector(".editor-textarea") as HTMLTextAreaElement;
        if (textarea && visualSelection.start) {
          const startOffset = calculateOffsetFromPosition(
            visualSelection.start.line,
            visualSelection.start.column,
            lines,
          );
          const endOffset = newOffset;

          if (startOffset <= endOffset) {
            textarea.selectionStart = startOffset;
            textarea.selectionEnd = endOffset;
          } else {
            textarea.selectionStart = endOffset;
            textarea.selectionEnd = startOffset;
          }
          textarea.dispatchEvent(new Event("select"));
        }

        return true;
      }

      return false;
    };

    // Add vim keyboard handler with high priority (capture phase)
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [vimMode, mode, isCommandMode, setMode, enterCommandMode, exitCommandMode, isCapturingInput]);

  // Handle vim-specific custom events
  useEffect(() => {
    if (!vimMode) return;

    const handleVimSave = () => {
      if (onSave) {
        onSave();
      }
    };

    const handleVimGotoLine = (e: CustomEvent) => {
      if (onGoToLine && e.detail?.line) {
        onGoToLine(e.detail.line);
      }
    };

    window.addEventListener("vim-save", handleVimSave);
    window.addEventListener("vim-goto-line", handleVimGotoLine as EventListener);

    return () => {
      window.removeEventListener("vim-save", handleVimSave);
      window.removeEventListener("vim-goto-line", handleVimGotoLine as EventListener);
    };
  }, [vimMode, onSave, onGoToLine]);

  return {
    isVimModeEnabled: vimMode,
    currentVimMode: mode,
    isCommandMode,
  };
};
