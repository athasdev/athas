import { useEffect } from "react";
import { useSettingsStore } from "@/settings/store";
import { useEditorCursorStore } from "@/stores/editor-cursor-store";
import { useEditorInstanceStore } from "@/stores/editor-instance-store";
import { useEditorViewStore } from "@/stores/editor-view-store";
import {
  executeReplaceCommand,
  executeVimCommand,
  getCommandParseStatus,
  parseVimCommand,
} from "@/stores/vim";
import { createVimEditing } from "@/stores/vim-editing";
import { useVimSearchStore } from "@/stores/vim-search";
import { useVimStore } from "@/stores/vim-store";
import { calculateOffsetFromPosition } from "@/utils/editor-position";

interface UseVimKeyboardProps {
  onSave?: () => void;
  onGoToLine?: (line: number) => void;
}

const getReplacementChar = (event: KeyboardEvent): string | null => {
  if (event.key.length === 1) {
    return event.key;
  }

  if (event.key === "Enter") {
    return "\n";
  }

  if (event.key === "Tab") {
    return "\t";
  }

  return null;
};

export const useVimKeyboard = ({ onSave, onGoToLine }: UseVimKeyboardProps) => {
  const { settings } = useSettingsStore();
  const vimMode = settings.vimMode;
  const mode = useVimStore.use.mode();
  const isCommandMode = useVimStore.use.isCommandMode();
  const _lastKey = useVimStore.use.lastKey();
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

      if (mode === "insert") {
        if (document.activeElement !== textarea) {
          textarea.focus();
        }
        const cursor = useEditorCursorStore.getState().cursorPosition;
        textarea.selectionStart = textarea.selectionEnd = cursor.offset;
        textarea.style.caretColor = "";
      } else if (mode === "visual") {
        if (document.activeElement !== textarea) {
          textarea.focus();
        }
        const cursor = useEditorCursorStore.getState().cursorPosition;
        textarea.selectionStart = textarea.selectionEnd = cursor.offset;
        textarea.style.caretColor = "transparent";
      } else {
        textarea.style.caretColor = "transparent";
        if (document.activeElement === textarea) {
          textarea.blur();
        }
      }
    }
  }, [vimMode, mode, isCommandMode, setCursorVisibility, setDisabled]);

  useEffect(() => {
    // Only activate vim keyboard handling when vim mode is enabled
    if (!vimMode) return;

    // Create vim navigation and editing commands
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
      const currentLastKey = useVimStore.getState().lastKey;

      if (currentLastKey === "r") {
        if (key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          clearLastKey();
          clearKeyBuffer();
          return true;
        }

        const replacementChar = getReplacementChar(e);
        if (!replacementChar) {
          clearLastKey();
          clearKeyBuffer();
          return false;
        }

        e.preventDefault();
        e.stopPropagation();

        const buffer = [...useVimStore.getState().keyBuffer];
        const command = parseVimCommand(buffer);
        const count = command?.count ?? 1;
        const commandKeys = [...buffer, replacementChar];
        const success = executeReplaceCommand(replacementChar, { count });
        if (!success) {
          console.warn("Failed to execute replace command:", commandKeys.join(""));
        }

        clearKeyBuffer();
        clearLastKey();
        return true;
      }

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
        case "u":
          e.preventDefault();
          e.stopPropagation();
          clearKeyBuffer();
          vimEdit.undo();
          return true;
        case "r": {
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
          const bufferBeforeReplace = [...useVimStore.getState().keyBuffer];
          const candidateBuffer = [...bufferBeforeReplace, "r"];
          if (getCommandParseStatus(candidateBuffer) === "invalid") {
            clearKeyBuffer();
          }
          addToKeyBuffer("r");
          setLastKey("r");
          return true;
        }
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
      }

      // Handle arrow keys by mapping them to vim motions
      if (key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        clearKeyBuffer();

        let vimKey = "";
        switch (key) {
          case "ArrowLeft":
            vimKey = "h";
            break;
          case "ArrowRight":
            vimKey = "l";
            break;
          case "ArrowUp":
            vimKey = "k";
            break;
          case "ArrowDown":
            vimKey = "j";
            break;
        }

        const success = executeVimCommand([vimKey]);
        if (!success) {
          console.warn("Failed to execute arrow key motion:", vimKey);
        }
        return true;
      }

      // Now handle vim command sequences with the new modular system
      // This supports: [count][operator][count][motion/text-object]
      // Examples: 3j, 5w, d3w, 3dw, ciw, di", dd, yy, etc.

      const buffer = getKeyBuffer();
      const candidateBuffer = [...buffer, key];
      const parseStatus = getCommandParseStatus(candidateBuffer);

      if (parseStatus === "invalid") {
        if (buffer.length > 0) {
          clearKeyBuffer();
        }
        return false;
      }

      e.preventDefault();
      e.stopPropagation();
      addToKeyBuffer(key);

      if (parseStatus === "complete") {
        const success = executeVimCommand(candidateBuffer);
        clearKeyBuffer();

        if (!success) {
          console.warn("Failed to execute vim command:", candidateBuffer.join(""));
        }
        return true;
      }

      // Waiting for more keys
      return true;
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

      const applyMotion = (motionKeys: string[]): boolean => {
        const success = executeVimCommand(motionKeys);
        if (!success) {
          console.warn("Failed to execute visual motion:", motionKeys.join(""));
          return false;
        }

        const newPosition = useEditorCursorStore.getState().cursorPosition;
        const lines = useEditorViewStore.getState().lines;

        const { setVisualSelection } = useVimStore.use.actions();
        if (visualSelection.start) {
          if (visualMode === "line") {
            setVisualSelection(
              { line: visualSelection.start.line, column: 0 },
              { line: newPosition.line, column: lines[newPosition.line].length },
            );
          } else {
            setVisualSelection(visualSelection.start, {
              line: newPosition.line,
              column: newPosition.column,
            });
          }
        }

        const textarea = document.querySelector(".editor-textarea") as HTMLTextAreaElement;
        if (textarea && visualSelection.start) {
          const startOffset = calculateOffsetFromPosition(
            visualSelection.start.line,
            visualSelection.start.column,
            lines,
          );
          const endOffset = newPosition.offset;

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
      };

      if (key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        clearKeyBuffer();

        let motionKeys: string[] | null = null;
        switch (key) {
          case "ArrowLeft":
            motionKeys = ["h"];
            break;
          case "ArrowRight":
            motionKeys = ["l"];
            break;
          case "ArrowUp":
            motionKeys = ["k"];
            break;
          case "ArrowDown":
            motionKeys = ["j"];
            break;
        }

        if (motionKeys) {
          applyMotion(motionKeys);
        }
        return true;
      }

      const buffer = getKeyBuffer();
      const candidateBuffer = [...buffer, key];
      const parseStatus = getCommandParseStatus(candidateBuffer);

      if (parseStatus === "invalid") {
        if (buffer.length > 0) {
          clearKeyBuffer();
        }
        return false;
      }

      e.preventDefault();
      e.stopPropagation();
      addToKeyBuffer(key);

      if (parseStatus === "complete") {
        applyMotion(candidateBuffer);
        clearKeyBuffer();
      }

      return true;
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
