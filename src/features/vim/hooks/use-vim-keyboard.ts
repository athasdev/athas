import { useEffect } from "react";
import { useEditorStateStore } from "@/features/editor/stores/state-store";
import { useEditorViewStore } from "@/features/editor/stores/view-store";
import { calculateOffsetFromPosition } from "@/features/editor/utils/position";
import { useSettingsStore } from "@/features/settings/store";
import {
  executeAST,
  executeVimCommand,
  getCommandParseStatus,
  isNewParserEnabled,
  // New grammar-based parser
  parse as parseGrammar,
} from "@/features/vim/core";
import { useVimSearchStore } from "@/features/vim/stores/vim-search";
import { useVimStore } from "@/features/vim/stores/vim-store";

interface UseVimKeyboardProps {
  onSave?: () => void;
  onGoToLine?: (line: number) => void;
}

const _getReplacementChar = (event: KeyboardEvent): string | null => {
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
    addToKeyBuffer,
    clearKeyBuffer,
    getKeyBuffer,
    setVisualMode,
  } = useVimStore.use.actions();
  const { setCursorVisibility } = useEditorStateStore.use.actions();
  const { setDisabled } = useEditorStateStore.use.actions();
  const { startSearch, findNext, findPrevious } = useVimSearchStore.use.actions();

  // Helper functions for accessing editor state
  const getCursorPosition = () => useEditorStateStore.getState().cursorPosition;
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
        const cursor = useEditorStateStore.getState().cursorPosition;
        textarea.selectionStart = textarea.selectionEnd = cursor.offset;
        textarea.style.caretColor = "";
      } else if (mode === "visual") {
        if (document.activeElement !== textarea) {
          textarea.focus();
        }
        const cursor = useEditorStateStore.getState().cursorPosition;
        textarea.selectionStart = textarea.selectionEnd = cursor.offset;
        textarea.style.caretColor = "transparent";
      } else {
        // Normal mode: keep textarea focused and show cursor with vim-normal color
        if (document.activeElement !== textarea) {
          textarea.focus();
        }
        const cursor = useEditorStateStore.getState().cursorPosition;
        textarea.selectionStart = textarea.selectionEnd = cursor.offset;
        textarea.style.caretColor = "transparent";
      }
    }
  }, [vimMode, mode, isCommandMode, setCursorVisibility, setDisabled]);

  useEffect(() => {
    // Only activate vim keyboard handling when vim mode is enabled
    if (!vimMode) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInputField =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      // Special handling for code editor textarea
      const isCodeEditor =
        target.tagName === "TEXTAREA" && target.classList.contains("editor-textarea");

      // Allow keyboard shortcuts with modifiers (Cmd/Ctrl/Alt) to pass through
      // Exception: Ctrl+r is vim redo, Ctrl+v is vim visual block mode
      if (
        (e.metaKey || e.ctrlKey || e.altKey) &&
        !(e.ctrlKey && e.key === "r" && !e.metaKey && !e.altKey) &&
        !(e.ctrlKey && e.key === "v" && !e.metaKey && !e.altKey && mode === "normal")
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

      // Special UI-only commands that don't go through Vim grammar
      // These need special handling for UI interaction
      switch (key) {
        case ":":
          e.preventDefault();
          e.stopPropagation();
          clearKeyBuffer();
          enterCommandMode();
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
        case "v": {
          e.preventDefault();
          e.stopPropagation();
          clearKeyBuffer();
          const currentPos = useEditorStateStore.getState().cursorPosition;
          const vimStore = useVimStore.getState();
          vimStore.actions.setVisualSelection(
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
          const currentPos = useEditorStateStore.getState().cursorPosition;
          const lines = useEditorViewStore.getState().lines;
          const vimStore = useVimStore.getState();
          vimStore.actions.setVisualSelection(
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
      }

      // Handle Ctrl+v for block visual mode (outside switch since it requires modifier)
      if (e.ctrlKey && key === "v" && !e.metaKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        clearKeyBuffer();
        const currentPos = useEditorStateStore.getState().cursorPosition;
        const vimStore = useVimStore.getState();
        vimStore.actions.setVisualSelection(
          { line: currentPos.line, column: currentPos.column },
          { line: currentPos.line, column: currentPos.column },
        );
        setVisualMode("block");
        setMode("visual");

        // Initialize textarea selection at current position
        const textarea = document.querySelector(".editor-textarea") as HTMLTextAreaElement;
        if (textarea) {
          textarea.selectionStart = textarea.selectionEnd = currentPos.offset;
          textarea.focus();
        }

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

        // Use new parser if enabled
        if (isNewParserEnabled()) {
          const result = parseGrammar([vimKey]);
          if (result.status === "complete") {
            const success = executeAST(result.command);
            if (!success) {
              console.warn("Failed to execute arrow key motion:", vimKey);
            }
          }
        } else {
          const success = executeVimCommand([vimKey]);
          if (!success) {
            console.warn("Failed to execute arrow key motion:", vimKey);
          }
        }
        return true;
      }

      // All other commands go through the grammar-based parser
      const buffer = getKeyBuffer();
      const candidateBuffer = [...buffer, key];

      // Use new grammar-based parser if enabled
      if (isNewParserEnabled()) {
        const result = parseGrammar(candidateBuffer);

        // Invalid command - reset buffer
        if (result.status === "invalid") {
          if (buffer.length > 0) {
            clearKeyBuffer();
          }
          return false;
        }

        e.preventDefault();
        e.stopPropagation();
        addToKeyBuffer(key);

        // Command is complete - execute it
        if (result.status === "complete") {
          const success = executeAST(result.command);
          clearKeyBuffer();

          if (!success) {
            console.warn("Failed to execute vim command:", candidateBuffer.join(""));
          }
          return true;
        }

        // Waiting for more keys (incomplete or needsChar)
        return true;
      }

      // Fallback to old parser (for testing/compatibility)
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

        // In Vim, when exiting insert mode, the cursor moves back one position
        // (unless already at the beginning of the line)
        const currentPos = getCursorPosition();
        const lines = getLines();

        if (currentPos.column > 0) {
          const newColumn = currentPos.column - 1;
          const newOffset = calculateOffsetFromPosition(currentPos.line, newColumn, lines);
          const newPosition = { line: currentPos.line, column: newColumn, offset: newOffset };

          const { setCursorPosition } = useEditorStateStore.getState().actions;
          setCursorPosition(newPosition);

          // Update textarea selection
          const textarea = document.querySelector(".editor-textarea") as HTMLTextAreaElement;
          if (textarea) {
            textarea.selectionStart = textarea.selectionEnd = newOffset;
          }
        }

        setMode("normal");
        return true;
      }
      // In insert mode, let most keys pass through to the editor
      return false;
    };

    const handleVisualMode = (e: KeyboardEvent) => {
      const key = e.key;

      // Special keys that don't go through the parser
      switch (key) {
        case "Escape":
          e.preventDefault();
          e.stopPropagation();
          clearKeyBuffer();
          setMode("normal");
          return true;
        case ":":
          e.preventDefault();
          e.stopPropagation();
          clearKeyBuffer();
          enterCommandMode();
          return true;
      }

      // Helper to apply motion and update visual selection
      const applyMotion = (motionKeys: string[]): boolean => {
        console.log("=== applyMotion START ===");
        console.log("Motion keys:", motionKeys);

        const vimStoreBefore = useVimStore.getState();
        console.log("Before motion - visualSelection:", vimStoreBefore.visualSelection);
        console.log("Before motion - cursor:", useEditorStateStore.getState().cursorPosition);

        let success = false;

        if (isNewParserEnabled()) {
          const result = parseGrammar(motionKeys);
          if (result.status === "complete") {
            success = executeAST(result.command);
          }
        } else {
          success = executeVimCommand(motionKeys);
        }

        if (!success) {
          console.warn("Failed to execute visual motion:", motionKeys.join(""));
          return false;
        }

        const newPosition = useEditorStateStore.getState().cursorPosition;
        const lines = useEditorViewStore.getState().lines;
        const vimStore = useVimStore.getState();

        console.log("After motion - cursor:", newPosition);

        // Get fresh visual selection state
        const currentVisualSelection = vimStore.visualSelection;
        const currentVisualMode = vimStore.visualMode;

        console.log("After motion - visualSelection from store:", currentVisualSelection);

        if (currentVisualSelection.start) {
          // Line mode: always select full lines
          if (currentVisualMode === "line") {
            const newStart = { line: currentVisualSelection.start.line, column: 0 };
            const newEnd = { line: newPosition.line, column: lines[newPosition.line].length };
            console.log("Setting line visual selection:", newStart, "to", newEnd);
            vimStore.actions.setVisualSelection(newStart, newEnd);
          } else {
            // Char/block mode: select from start to cursor
            const newEnd = { line: newPosition.line, column: newPosition.column };
            console.log(
              "Setting char/block visual selection:",
              currentVisualSelection.start,
              "to",
              newEnd,
            );
            vimStore.actions.setVisualSelection(currentVisualSelection.start, newEnd);
          }
        }

        // Update textarea selection
        const textarea = document.querySelector(".editor-textarea") as HTMLTextAreaElement;
        if (textarea && currentVisualSelection.start) {
          const startOffset = calculateOffsetFromPosition(
            currentVisualSelection.start.line,
            currentVisualSelection.start.column,
            lines,
          );
          const endOffset = newPosition.offset;

          console.log("Textarea offsets - start:", startOffset, "end:", endOffset);
          console.log(
            "Setting textarea selection:",
            Math.min(startOffset, endOffset),
            "to",
            Math.max(startOffset, endOffset),
          );

          textarea.selectionStart = Math.min(startOffset, endOffset);
          textarea.selectionEnd = Math.max(startOffset, endOffset);

          // Don't dispatch select event - it causes cursor position to be overridden
          // textarea.dispatchEvent(new Event("select"));
        }

        console.log("=== applyMotion END ===\n");
        return true;
      };

      // Handle arrow keys (map to hjkl motions)
      if (key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        clearKeyBuffer();

        const motionMap: Record<string, string> = {
          ArrowLeft: "h",
          ArrowRight: "l",
          ArrowUp: "k",
          ArrowDown: "j",
        };

        applyMotion([motionMap[key]]);
        return true;
      }

      // Use grammar parser for all other commands
      const buffer = getKeyBuffer();
      const candidateBuffer = [...buffer, key];

      if (isNewParserEnabled()) {
        const result = parseGrammar(candidateBuffer, "visual");

        // Invalid command - reset buffer
        if (result.status === "invalid") {
          if (buffer.length > 0) {
            clearKeyBuffer();
          }
          return false;
        }

        e.preventDefault();
        e.stopPropagation();
        addToKeyBuffer(key);

        // Command is complete - execute it
        if (result.status === "complete") {
          const cmd = result.command;

          // Visual operators and text objects are handled by executeAST
          if (cmd.kind === "visualOperator" || cmd.kind === "visualTextObject") {
            const success = executeAST(cmd);
            clearKeyBuffer();
            return success;
          }

          // Motions extend the selection
          if (cmd.kind === "motion") {
            const success = applyMotion(candidateBuffer);
            clearKeyBuffer();
            return success;
          }

          clearKeyBuffer();
          return true;
        }

        // Waiting for more keys (incomplete or needsChar)
        return true;
      }

      // Fallback to old parser for motions
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
  }, [
    vimMode,
    mode,
    isCommandMode,
    setMode,
    enterCommandMode,
    exitCommandMode,
    isCapturingInput,
    setVisualMode,
    clearKeyBuffer,
    addToKeyBuffer,
    getKeyBuffer,
    startSearch,
    findNext,
    findPrevious,
  ]);

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
