import { useEffect } from "react";
import { useSettingsStore } from "@/settings/store";
import { useEditorCursorStore } from "@/stores/editor-cursor-store";
import { useEditorInstanceStore } from "@/stores/editor-instance-store";
import { useEditorViewStore } from "@/stores/editor-view-store";
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
  } = useVimStore.use.actions();
  const { setCursorVisibility } = useEditorCursorStore.use.actions();
  const { setDisabled } = useEditorInstanceStore();
  const { startSearch, findNext, findPrevious } = useVimSearchStore.use.actions();

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
      return;
    }

    // In vim mode:
    // - Insert mode: allow typing (enabled)
    // - Normal/Visual modes: prevent typing (disabled) but keep cursor visible for navigation
    // - Command mode: disable editor, command bar handles input
    const shouldDisableEditor = mode !== "insert";
    const shouldShowCursor = true; // Always show cursor in vim mode

    setDisabled(shouldDisableEditor);
    setCursorVisibility(shouldShowCursor);

    // Update textarea data attributes for CSS styling
    const textarea = document.querySelector(".editor-textarea") as HTMLTextAreaElement;
    if (textarea) {
      const vimModeAttr = isCommandMode ? "command" : mode;
      textarea.setAttribute("data-vim-mode", vimModeAttr);

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

      switch (e.key) {
        case "i":
          e.preventDefault();
          e.stopPropagation(); // Prevent other handlers from processing this
          setMode("insert");
          return true; // Indicate we handled the key
        case "a":
          e.preventDefault();
          e.stopPropagation();
          vimEdit.appendToLine();
          setMode("insert");
          return true;
        case "A":
          e.preventDefault();
          e.stopPropagation();
          vimEdit.appendToLine();
          setMode("insert");
          return true;
        case "I":
          e.preventDefault();
          e.stopPropagation();
          vimEdit.insertAtLineStart();
          setMode("insert");
          return true;
        case "o":
          e.preventDefault();
          e.stopPropagation();
          vimEdit.openLineBelow();
          setMode("insert");
          return true;
        case "O":
          e.preventDefault();
          e.stopPropagation();
          vimEdit.openLineAbove();
          setMode("insert");
          return true;
        case ":":
          e.preventDefault();
          e.stopPropagation();
          enterCommandMode();
          return true;
        case "v": {
          e.preventDefault();
          e.stopPropagation();
          // Start visual selection at current cursor position
          const currentPos = useEditorCursorStore.getState().cursorPosition;
          const { setVisualSelection } = useVimStore.use.actions();
          setVisualSelection(
            { line: currentPos.line, column: currentPos.column },
            { line: currentPos.line, column: currentPos.column },
          );
          setMode("visual");
          return true;
        }
        case "V": {
          e.preventDefault();
          e.stopPropagation();
          // Start visual line selection (select entire current line)
          const currentPos = useEditorCursorStore.getState().cursorPosition;
          const lines = useEditorViewStore.getState().lines;
          const _lineStart = calculateOffsetFromPosition(currentPos.line, 0, lines);
          const _lineEnd = calculateOffsetFromPosition(
            currentPos.line,
            lines[currentPos.line].length,
            lines,
          );
          const { setVisualSelection } = useVimStore.use.actions();
          setVisualSelection(
            { line: currentPos.line, column: 0 },
            { line: currentPos.line, column: lines[currentPos.line].length },
          );
          setMode("visual");
          return true;
        }
        case "Escape":
          e.preventDefault();
          e.stopPropagation();
          // Already in normal mode, but ensure we exit any sub-modes
          setMode("normal");
          return true;
        // Navigation keys - hjkl movement
        case "h":
          e.preventDefault();
          e.stopPropagation();
          vimNav.moveLeft();
          return true;
        case "j":
          e.preventDefault();
          e.stopPropagation();
          vimNav.moveDown();
          return true;
        case "k":
          e.preventDefault();
          e.stopPropagation();
          vimNav.moveUp();
          return true;
        case "l":
          e.preventDefault();
          e.stopPropagation();
          vimNav.moveRight();
          return true;
        case "w":
          e.preventDefault();
          e.stopPropagation();
          vimNav.moveWordForward();
          return true;
        case "b":
          e.preventDefault();
          e.stopPropagation();
          vimNav.moveWordBackward();
          return true;
        case "0":
          e.preventDefault();
          e.stopPropagation();
          vimNav.moveToLineStart();
          return true;
        case "$":
          e.preventDefault();
          e.stopPropagation();
          vimNav.moveToLineEnd();
          return true;
        case "g":
          e.preventDefault();
          e.stopPropagation();
          if (lastKey === "g") {
            // gg - go to top
            vimNav.moveToFileStart();
            clearLastKey();
          } else {
            // First g, wait for second key
            setLastKey("g");
          }
          return true;
        case "G":
          e.preventDefault();
          e.stopPropagation();
          vimNav.moveToFileEnd();
          return true;
        // Text editing commands
        case "d":
          e.preventDefault();
          e.stopPropagation();
          if (lastKey === "d") {
            // dd - delete line
            vimEdit.deleteLine();
            clearLastKey();
          } else {
            // First d, wait for second key
            setLastKey("d");
          }
          return true;
        case "y":
          e.preventDefault();
          e.stopPropagation();
          if (lastKey === "y") {
            // yy - yank line
            vimEdit.yankLine();
            clearLastKey();
          } else {
            // First y, wait for second key
            setLastKey("y");
          }
          return true;
        case "p":
          e.preventDefault();
          e.stopPropagation();
          vimEdit.paste();
          clearLastKey(); // Clear any pending double key commands
          return true;
        case "P":
          e.preventDefault();
          e.stopPropagation();
          vimEdit.pasteAbove();
          clearLastKey();
          return true;
        case "u":
          e.preventDefault();
          e.stopPropagation();
          vimEdit.undo();
          clearLastKey();
          return true;
        case "r":
          if (e.ctrlKey) {
            e.preventDefault();
            e.stopPropagation();
            vimEdit.redo();
            clearLastKey();
            return true;
          }
          break;
        case "x":
          e.preventDefault();
          e.stopPropagation();
          vimEdit.deleteChar();
          clearLastKey();
          return true;
        case "X":
          e.preventDefault();
          e.stopPropagation();
          vimEdit.deleteCharBefore();
          clearLastKey();
          return true;
        // Search commands
        case "/":
          e.preventDefault();
          e.stopPropagation();
          startSearch();
          clearLastKey();
          return true;
        case "n":
          e.preventDefault();
          e.stopPropagation();
          findNext();
          clearLastKey();
          return true;
        case "N":
          e.preventDefault();
          e.stopPropagation();
          findPrevious();
          clearLastKey();
          return true;
      }

      // Clear lastKey if any other key is pressed
      if (lastKey) {
        clearLastKey();
      }

      return false; // Return false for unhandled keys
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
      switch (e.key) {
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
        // Movement keys in visual mode extend selection
        case "h":
        case "j":
        case "k":
        case "l":
        case "w":
        case "b":
          e.preventDefault();
          e.stopPropagation();
          // Would need editor integration for visual selection
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
