import { useEffect, useRef } from "react";
import { useEditorStateStore } from "@/features/editor/stores/state-store";
import { useEditorUIStore } from "@/features/editor/stores/ui-store";
import { useEditorViewStore } from "@/features/editor/stores/view-store";
import { calculateOffsetFromPosition } from "@/features/editor/utils/position";
import { useSettingsStore } from "@/features/settings/store";
import { useUIState } from "@/features/window/stores/ui-state-store";
import {
  executeReplaceCommand,
  executeVimCommand,
  getEditorContext,
} from "@/features/vim/core/core/command-executor";
import { getCommandParseStatus, parseVimCommand } from "@/features/vim/core/core/command-parser";
import { createFindCharMotion } from "@/features/vim/core/motions/character-motions";
import { getOperator } from "@/features/vim/core/operators/operator-registry";
import { createDomEditorFacade } from "@/features/vim/core/dom-editor-facade";
import { createVimEditing } from "@/features/vim/stores/vim-editing";
import { useVimSearchStore } from "@/features/vim/stores/vim-search";
import { useVimStore } from "@/features/vim/stores/vim-store";

interface UseVimKeyboardProps {
  onSave?: () => void;
  onGoToLine?: (line: number) => void;
}

type VisualPoint = {
  line: number;
  column: number;
};

const getDocumentLength = (lines: string[]): number =>
  lines.reduce((sum, line, index) => sum + line.length + (index < lines.length - 1 ? 1 : 0), 0);

const getVisibleLineCount = (): number => {
  const { visibleLines } = createDomEditorFacade().getViewportMetrics();
  return visibleLines;
};

const getVisualSelectionOffsets = (
  start: VisualPoint | null,
  end: VisualPoint | null,
  lines: string[],
  visualMode: "char" | "line" | null,
): { start: number; end: number } | null => {
  if (!start || !end || lines.length === 0) return null;

  if (visualMode === "line") {
    const startLine = Math.min(start.line, end.line);
    const endLine = Math.max(start.line, end.line);
    const startOffset = calculateOffsetFromPosition(startLine, 0, lines);
    const endOffset =
      endLine < lines.length - 1
        ? calculateOffsetFromPosition(endLine + 1, 0, lines)
        : calculateOffsetFromPosition(endLine, lines[endLine].length, lines);

    return {
      start: startOffset,
      end: Math.max(startOffset, endOffset),
    };
  }

  const anchorOffset = calculateOffsetFromPosition(start.line, start.column, lines);
  const cursorOffset = calculateOffsetFromPosition(end.line, end.column, lines);
  const startOffset = Math.min(anchorOffset, cursorOffset);
  const inclusiveEndOffset = Math.min(
    getDocumentLength(lines),
    Math.max(anchorOffset, cursorOffset) + 1,
  );

  return {
    start: startOffset,
    end: Math.max(startOffset, inclusiveEndOffset),
  };
};

const applyTextareaSelection = (selection: { start: number; end: number }) => {
  createDomEditorFacade().setSelection(selection.start, selection.end);
};

const collapseTextareaSelection = (offset: number) => {
  createDomEditorFacade().collapseSelection(offset);
};

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
  const visualSelection = useVimStore.use.visualSelection();
  const activeVisualMode = useVimStore.use.visualMode();
  const {
    setMode,
    enterCommandMode,
    exitCommandMode,
    isCapturingInput,
    setLastKey,
    clearLastKey,
    addToKeyBuffer,
    clearKeyBuffer,
    getKeyBuffer,
    enterVisualMode,
  } = useVimStore.use.actions();
  const { setCursorVisibility, setCursorPosition } = useEditorStateStore.use.actions();
  const { setDisabled } = useEditorStateStore.use.actions();
  const { setLastSearch } = useVimSearchStore.use.actions();

  // Helper functions for accessing editor state
  const getCursorPosition = () => useEditorStateStore.getState().cursorPosition;
  const getLines = () => useEditorViewStore.getState().lines;

  // Reset vim state only when vim mode transitions from disabled to enabled.
  const wasVimEnabledRef = useRef(false);
  useEffect(() => {
    if (vimMode && !wasVimEnabledRef.current) {
      useVimStore.getState().actions.reset();
    }
    wasVimEnabledRef.current = vimMode;
  }, [vimMode]);

  // Control editor state based on vim mode
  useEffect(() => {
    const facade = createDomEditorFacade();

    if (!vimMode) {
      // When vim mode is off, ensure editor is enabled
      setDisabled(false);
      setCursorVisibility(true);

      facade.setReadOnly(false);
      facade.setDataVimMode(null);
      facade.setCaretColor("");

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
    const vimModeAttr = isCommandMode ? "command" : mode;
    facade.setDataVimMode(vimModeAttr);
    facade.setReadOnly(shouldReadOnly);

    // Add body class for global vim mode styling
    document.body.classList.remove(
      "vim-mode-normal",
      "vim-mode-insert",
      "vim-mode-visual",
      "vim-mode-command",
    );
    document.body.classList.add(`vim-mode-${vimModeAttr}`);

    if (mode === "insert") {
      // Only set cursor position if textarea doesn't have focus
      // If it has focus, a vim command (like I, A, o, O) already positioned it
      if (!facade.isFocused()) {
        facade.focus();
        const cursor = useEditorStateStore.getState().cursorPosition;
        facade.collapseSelection(cursor.offset);
      }
      facade.setCaretColor("");
    } else if (mode === "visual") {
      if (!facade.isFocused()) {
        facade.focus();
      }
      const lines = useEditorViewStore.getState().lines;
      const selectionOffsets = getVisualSelectionOffsets(
        visualSelection.start,
        visualSelection.end,
        lines,
        activeVisualMode,
      );
      if (selectionOffsets) {
        applyTextareaSelection(selectionOffsets);
      } else {
        const cursor = useEditorStateStore.getState().cursorPosition;
        collapseTextareaSelection(cursor.offset);
      }
      facade.setCaretColor("transparent");
    } else {
      const cursor = useEditorStateStore.getState().cursorPosition;
      collapseTextareaSelection(cursor.offset);
      facade.setCaretColor("transparent");
      if (facade.isFocused()) {
        facade.blur();
      }
    }
  }, [
    vimMode,
    mode,
    isCommandMode,
    setCursorVisibility,
    setDisabled,
    visualSelection,
    activeVisualMode,
  ]);

  useEffect(() => {
    // Only activate vim keyboard handling when vim mode is enabled
    if (!vimMode) return;

    // Create vim navigation and editing commands
    const vimEdit = createVimEditing();
    const facade = createDomEditorFacade();

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const currentVimState = useVimStore.getState();
      const currentMode = currentVimState.mode;
      const currentCommandMode = currentVimState.isCommandMode;
      const isInputField =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      // Special handling for code editor textarea
      const isCodeEditor =
        target.tagName === "TEXTAREA" && target.classList.contains("editor-textarea");

      // Allow keyboard shortcuts with modifiers (Cmd/Ctrl/Alt) to pass through
      // Exceptions: Ctrl+r (redo), Ctrl+d/u/f/b (scroll motions), Ctrl+o/i (jump list)
      if (
        (e.metaKey || e.ctrlKey || e.altKey) &&
        !(
          e.ctrlKey &&
          !e.metaKey &&
          !e.altKey &&
          ["r", "d", "u", "f", "b", "o", "i"].includes(e.key)
        )
      ) {
        return;
      }

      if (isCodeEditor) {
        // In code editor, vim mode takes precedence
        // Let vim handle all keys when vim mode is active
      } else if (isInputField && !currentCommandMode) {
        // For other input fields, only handle escape
        if (e.key === "Escape" && currentMode === "insert") {
          e.preventDefault();
          setMode("normal");
        }
        return;
      }

      // Handle vim commands based on current mode
      let handled = false;
      switch (currentMode) {
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
        const success = executeReplaceCommand(replacementChar, { count });
        if (!success) {
          clearKeyBuffer();
          clearLastKey();
          return true;
        }

        clearKeyBuffer();
        clearLastKey();
        return true;
      }

      // Handle " (register selection) - wait for register name
      if (currentLastKey === '"') {
        if (key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          clearLastKey();
          clearKeyBuffer();
          return true;
        }

        if (key.length !== 1) {
          clearLastKey();
          clearKeyBuffer();
          return false;
        }

        e.preventDefault();
        e.stopPropagation();

        const { setCurrentRegister } = useVimStore.getState().actions;
        setCurrentRegister(key);
        clearLastKey();
        clearKeyBuffer();
        return true;
      }

      // Handle m (set mark) - wait for mark name
      if (currentLastKey === "m") {
        if (key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          clearLastKey();
          clearKeyBuffer();
          return true;
        }

        if (key.length !== 1 || !/[a-zA-Z]/.test(key)) {
          clearLastKey();
          clearKeyBuffer();
          return false;
        }

        e.preventDefault();
        e.stopPropagation();

        const curPos = getCursorPosition();
        useVimStore.getState().actions.setMark(key, curPos.line, curPos.column);
        clearLastKey();
        clearKeyBuffer();
        return true;
      }

      // Handle ' (jump to mark line) - wait for mark name
      if (currentLastKey === "'") {
        if (key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          clearLastKey();
          clearKeyBuffer();
          return true;
        }

        if (key.length !== 1 || !/[a-zA-Z]/.test(key)) {
          clearLastKey();
          clearKeyBuffer();
          return false;
        }

        e.preventDefault();
        e.stopPropagation();

        const mark = useVimStore.getState().actions.getMark(key);
        if (mark) {
          const curPos = getCursorPosition();
          useVimStore.getState().actions.pushJump(curPos.line, curPos.column);

          const lines = getLines();
          const targetLine = Math.min(mark.line, lines.length - 1);
          const lineContent = lines[targetLine];
          let firstNonBlank = 0;
          while (firstNonBlank < lineContent.length && /\s/.test(lineContent[firstNonBlank])) {
            firstNonBlank++;
          }

          const newOffset = calculateOffsetFromPosition(targetLine, firstNonBlank, lines);
          setCursorPosition({
            line: targetLine,
            column: firstNonBlank,
            offset: newOffset,
          });

          facade.collapseSelection(newOffset);
        }

        clearLastKey();
        clearKeyBuffer();
        return true;
      }

      // Handle ` (jump to exact mark position) - wait for mark name
      if (currentLastKey === "`") {
        if (key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          clearLastKey();
          clearKeyBuffer();
          return true;
        }

        if (key.length !== 1 || !/[a-zA-Z]/.test(key)) {
          clearLastKey();
          clearKeyBuffer();
          return false;
        }

        e.preventDefault();
        e.stopPropagation();

        const mark = useVimStore.getState().actions.getMark(key);
        if (mark) {
          const curPos = getCursorPosition();
          useVimStore.getState().actions.pushJump(curPos.line, curPos.column);

          const lines = getLines();
          const targetLine = Math.min(mark.line, lines.length - 1);
          const lineContent = lines[targetLine];
          const targetColumn = Math.min(mark.column, lineContent.length);

          const newOffset = calculateOffsetFromPosition(targetLine, targetColumn, lines);
          setCursorPosition({
            line: targetLine,
            column: targetColumn,
            offset: newOffset,
          });

          facade.collapseSelection(newOffset);
        }

        clearLastKey();
        clearKeyBuffer();
        return true;
      }

      if (
        currentLastKey === "f" ||
        currentLastKey === "F" ||
        currentLastKey === "t" ||
        currentLastKey === "T"
      ) {
        if (key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          clearLastKey();
          clearKeyBuffer();
          return true;
        }

        if (key.length !== 1) {
          clearLastKey();
          clearKeyBuffer();
          return false;
        }

        e.preventDefault();
        e.stopPropagation();

        const direction = currentLastKey === "f" || currentLastKey === "t" ? "forward" : "backward";
        const type = currentLastKey === "f" || currentLastKey === "F" ? "find" : "to";

        const buffer = [...useVimStore.getState().keyBuffer];
        buffer.pop();
        const command = parseVimCommand(buffer);
        const count = command?.count ?? 1;

        const motion = createFindCharMotion(key, direction, type);
        const curPos = getCursorPosition();
        const lines = getLines();
        const range = motion.calculate(curPos, lines, count);

        // If there's an operator pending (e.g., df; ct;), execute it
        if (command?.operator) {
          const operator = getOperator(command.operator);
          if (operator) {
            const context = getEditorContext();
            if (context) {
              operator.execute(range, context);
              if (operator.entersInsertMode) {
                setMode("insert");
              }
            }
          }
        } else if (range.end.line !== curPos.line || range.end.column !== curPos.column) {
          setCursorPosition(range.end);
          facade.collapseSelection(range.end.offset);
        }

        clearKeyBuffer();
        clearLastKey();
        return true;
      }

      // Handle special commands that don't fit the operator-motion pattern
      // These commands are handled directly without going through the key buffer
      switch (key) {
        case "i": {
          // Only enter insert mode if there's no pending command in the buffer.
          // When the buffer has an operator (e.g. "c" or "d"), "i" is a text
          // object specifier (inner) and must fall through to the parser.
          if (getKeyBuffer().length === 0) {
            e.preventDefault();
            e.stopPropagation();
            clearKeyBuffer();
            facade.saveUndoState();
            setMode("insert");
            return true;
          }
          break;
        }
        case "a": {
          // Same as "i" above: with a pending operator, "a" means "around".
          if (getKeyBuffer().length === 0) {
            e.preventDefault();
            e.stopPropagation();
            clearKeyBuffer();
            // Move cursor one position right before entering insert mode
            const currentPos = getCursorPosition();
            const lines = getLines();
            const newColumn = Math.min(lines[currentPos.line].length, currentPos.column + 1);
            const newOffset = calculateOffsetFromPosition(currentPos.line, newColumn, lines);
            const newPosition = {
              line: currentPos.line,
              column: newColumn,
              offset: newOffset,
            };
            setCursorPosition(newPosition);

            // Update textarea cursor
            facade.collapseSelection(newOffset);

            facade.saveUndoState();
            setMode("insert");
            return true;
          }
          break;
        }
        case "A":
          e.preventDefault();
          e.stopPropagation();
          clearKeyBuffer();
          vimEdit.appendToLine();
          facade.saveUndoState();
          setMode("insert");
          return true;
        case "I":
          e.preventDefault();
          e.stopPropagation();
          clearKeyBuffer();
          vimEdit.insertAtLineStart();
          facade.saveUndoState();
          setMode("insert");
          return true;
        case "o": {
          if (e.ctrlKey) {
            e.preventDefault();
            e.stopPropagation();
            clearKeyBuffer();
            const jumpEntry = useVimStore.getState().actions.jumpBack();
            if (jumpEntry) {
              const lines = getLines();
              const targetLine = Math.min(jumpEntry.line, lines.length - 1);
              const lineContent = lines[targetLine];
              const targetColumn = Math.min(jumpEntry.column, lineContent.length);
              const newOffset = calculateOffsetFromPosition(targetLine, targetColumn, lines);
              setCursorPosition({
                line: targetLine,
                column: targetColumn,
                offset: newOffset,
              });
              facade.collapseSelection(newOffset);
            }
            return true;
          }
          e.preventDefault();
          e.stopPropagation();
          clearKeyBuffer();
          vimEdit.openLineBelow();
          setMode("insert");
          return true;
        }
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
          const currentPos = useEditorStateStore.getState().cursorPosition;
          const lines = useEditorViewStore.getState().lines;
          enterVisualMode("char", {
            line: currentPos.line,
            column: currentPos.column,
          });

          // Initialize textarea selection at current position
          facade.focus();
          const selectionOffsets = getVisualSelectionOffsets(
            { line: currentPos.line, column: currentPos.column },
            { line: currentPos.line, column: currentPos.column },
            lines,
            "char",
          );
          if (selectionOffsets) {
            applyTextareaSelection(selectionOffsets);
          }

          return true;
        }
        case "V": {
          e.preventDefault();
          e.stopPropagation();
          clearKeyBuffer();
          const currentPos = useEditorStateStore.getState().cursorPosition;
          const lines = useEditorViewStore.getState().lines;
          enterVisualMode("line", { line: currentPos.line, column: 0 });

          // Initialize textarea selection for the whole line
          facade.focus();
          const selectionOffsets = getVisualSelectionOffsets(
            { line: currentPos.line, column: 0 },
            { line: currentPos.line, column: 0 },
            lines,
            "line",
          );
          if (selectionOffsets) {
            applyTextareaSelection(selectionOffsets);
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
          if (e.ctrlKey) {
            e.preventDefault();
            e.stopPropagation();
            clearKeyBuffer();
            {
              const halfPage = Math.max(1, Math.floor(getVisibleLineCount() / 2));
              const keys = [...String(halfPage).split(""), "k"];
              executeVimCommand(keys);
            }
            return true;
          }
          e.preventDefault();
          e.stopPropagation();
          {
            // Read count from key buffer (e.g., "4u" undo 4 changes)
            const buffer = getKeyBuffer();
            const countStr = buffer.join("");
            const count = countStr ? parseInt(countStr, 10) : 1;
            clearKeyBuffer();
            vimEdit.undo(Number.isNaN(count) ? 1 : count);
          }
          return true;
        case "-":
          // g-: go to older text state (undo)
          if (getKeyBuffer().join("") === "g") {
            e.preventDefault();
            e.stopPropagation();
            clearKeyBuffer();
            vimEdit.undo();
            return true;
          }
          break;
        case "+":
          // g+: go to newer text state (redo)
          if (getKeyBuffer().join("") === "g") {
            e.preventDefault();
            e.stopPropagation();
            clearKeyBuffer();
            vimEdit.redo();
            return true;
          }
          break;
        case "d": {
          if (e.ctrlKey) {
            e.preventDefault();
            e.stopPropagation();
            clearKeyBuffer();
            const halfPage = Math.max(1, Math.floor(getVisibleLineCount() / 2));
            const keys = [...String(halfPage).split(""), "j"];
            executeVimCommand(keys);
            return true;
          }
          break;
        }
        case "f": {
          if (e.ctrlKey) {
            e.preventDefault();
            e.stopPropagation();
            clearKeyBuffer();
            const fullPage = Math.max(1, getVisibleLineCount() - 2);
            const keys = [...String(fullPage).split(""), "j"];
            executeVimCommand(keys);
            return true;
          }
          e.preventDefault();
          e.stopPropagation();
          addToKeyBuffer(key);
          setLastKey(key);
          return true;
        }
        case "b": {
          if (e.ctrlKey) {
            e.preventDefault();
            e.stopPropagation();
            clearKeyBuffer();
            const fullPage = Math.max(1, getVisibleLineCount() - 2);
            const keys = [...String(fullPage).split(""), "k"];
            executeVimCommand(keys);
            return true;
          }
          break;
        }
        case "?": {
          e.preventDefault();
          e.stopPropagation();
          clearKeyBuffer();
          const curPos = getCursorPosition();
          useVimStore.getState().actions.pushJump(curPos.line, curPos.column);
          useUIState.getState().setIsFindVisible(true);
          useVimSearchStore.getState().actions.setLastSearch("", "backward");
          return true;
        }
        case "r": {
          if (e.ctrlKey) {
            e.preventDefault();
            e.stopPropagation();
            // Read count from key buffer (e.g., "4<C-r>" redo 4 changes)
            const buffer = getKeyBuffer();
            const countStr = buffer.join("");
            const count = countStr ? parseInt(countStr, 10) : 1;
            clearKeyBuffer();
            vimEdit.redo(Number.isNaN(count) ? 1 : count);
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
        case "/": {
          e.preventDefault();
          e.stopPropagation();
          clearKeyBuffer();
          const curPos = getCursorPosition();
          useVimStore.getState().actions.pushJump(curPos.line, curPos.column);
          useUIState.getState().setIsFindVisible(true);
          useVimSearchStore.getState().actions.setLastSearch("", "forward");
          return true;
        }
        case "n": {
          e.preventDefault();
          e.stopPropagation();
          clearKeyBuffer();
          const curPos = getCursorPosition();
          useVimStore.getState().actions.pushJump(curPos.line, curPos.column);
          const { lastSearchDirection } = useVimSearchStore.getState();
          const { searchNext, searchPrevious } = useEditorUIStore.getState().actions;
          if (lastSearchDirection === "backward") {
            searchPrevious();
          } else {
            searchNext();
          }
          return true;
        }
        case "N": {
          e.preventDefault();
          e.stopPropagation();
          clearKeyBuffer();
          const curPos = getCursorPosition();
          useVimStore.getState().actions.pushJump(curPos.line, curPos.column);
          const { lastSearchDirection } = useVimSearchStore.getState();
          const { searchNext, searchPrevious } = useEditorUIStore.getState().actions;
          if (lastSearchDirection === "backward") {
            searchNext();
          } else {
            searchPrevious();
          }
          return true;
        }
        case "F":
        case "t":
        case "T":
          e.preventDefault();
          e.stopPropagation();
          addToKeyBuffer(key);
          setLastKey(key);
          return true;
        case "*": {
          e.preventDefault();
          e.stopPropagation();
          clearKeyBuffer();
          const curPos = getCursorPosition();
          const lines = getLines();
          useVimStore.getState().actions.pushJump(curPos.line, curPos.column);
          const line = lines[curPos.line];
          let wordStart = curPos.column;
          let wordEnd = curPos.column;
          while (wordStart > 0 && /\w/.test(line[wordStart - 1])) wordStart--;
          while (wordEnd < line.length && /\w/.test(line[wordEnd])) wordEnd++;
          const word = line.slice(wordStart, wordEnd);
          if (word) {
            const { setSearchQuery, searchNext } = useEditorUIStore.getState().actions;
            setSearchQuery(word);
            searchNext();
            useVimSearchStore.getState().actions.setLastSearch(word, "forward");
          }
          return true;
        }
        case "#": {
          e.preventDefault();
          e.stopPropagation();
          clearKeyBuffer();
          const curPos = getCursorPosition();
          const lines = getLines();
          useVimStore.getState().actions.pushJump(curPos.line, curPos.column);
          const line = lines[curPos.line];
          let wordStart = curPos.column;
          let wordEnd = curPos.column;
          while (wordStart > 0 && /\w/.test(line[wordStart - 1])) wordStart--;
          while (wordEnd < line.length && /\w/.test(line[wordEnd])) wordEnd++;
          const word = line.slice(wordStart, wordEnd);
          if (word) {
            const { setSearchQuery, searchPrevious } = useEditorUIStore.getState().actions;
            setSearchQuery(word);
            searchPrevious();
            useVimSearchStore.getState().actions.setLastSearch(word, "backward");
          }
          return true;
        }
        case '"':
          e.preventDefault();
          e.stopPropagation();
          clearKeyBuffer();
          setLastKey('"');
          return true;
        case "m":
          e.preventDefault();
          e.stopPropagation();
          clearKeyBuffer();
          setLastKey("m");
          return true;
        case "'":
          e.preventDefault();
          e.stopPropagation();
          clearKeyBuffer();
          setLastKey("'");
          return true;
        case "`":
          e.preventDefault();
          e.stopPropagation();
          clearKeyBuffer();
          setLastKey("`");
          return true;
      }

      // Handle Ctrl+i (jump forward)
      if (e.ctrlKey && key === "i") {
        e.preventDefault();
        e.stopPropagation();
        clearKeyBuffer();
        const jumpEntry = useVimStore.getState().actions.jumpForward();
        if (jumpEntry) {
          const lines = getLines();
          const targetLine = Math.min(jumpEntry.line, lines.length - 1);
          const lineContent = lines[targetLine];
          const targetColumn = Math.min(jumpEntry.column, lineContent.length);
          const newOffset = calculateOffsetFromPosition(targetLine, targetColumn, lines);
          setCursorPosition({
            line: targetLine,
            column: targetColumn,
            offset: newOffset,
          });
          facade.collapseSelection(newOffset);
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

        executeVimCommand([vimKey]);
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
        executeVimCommand(candidateBuffer);
        clearKeyBuffer();
        return true;
      }

      // Waiting for more keys
      return true;
    };

    const handleInsertMode = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();

        // Move cursor back one position (vim behavior)
        const currentPos = getCursorPosition();
        if (currentPos.column > 0) {
          const lines = getLines();
          const newColumn = currentPos.column - 1;
          const newOffset = calculateOffsetFromPosition(currentPos.line, newColumn, lines);
          const newPosition = {
            line: currentPos.line,
            column: newColumn,
            offset: newOffset,
          };
          setCursorPosition(newPosition);

          facade.collapseSelection(newOffset);
        }

        setMode("normal");
        return true;
      }
      // In insert mode, let most keys pass through to the editor
      return false;
    };

    const handleVisualMode = (e: KeyboardEvent) => {
      const key = e.key;
      const currentVisualMode = useVimStore.getState().visualMode;
      const visualSelection = useVimStore.getState().visualSelection;
      const currentLastKey = useVimStore.getState().lastKey;

      if (
        currentLastKey === "f" ||
        currentLastKey === "F" ||
        currentLastKey === "t" ||
        currentLastKey === "T"
      ) {
        if (key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          clearLastKey();
          clearKeyBuffer();
          return true;
        }

        if (key.length !== 1) {
          clearLastKey();
          clearKeyBuffer();
          return false;
        }

        e.preventDefault();
        e.stopPropagation();

        const direction = currentLastKey === "f" || currentLastKey === "t" ? "forward" : "backward";
        const type = currentLastKey === "f" || currentLastKey === "F" ? "find" : "to";

        const motion = createFindCharMotion(key, direction, type);
        const curPos = getCursorPosition();
        const lines = getLines();
        const range = motion.calculate(curPos, lines, 1);

        if (range.end.line !== curPos.line || range.end.column !== curPos.column) {
          setCursorPosition(range.end);

          const { setVisualSelection } = useVimStore.use.actions();
          if (visualSelection.start) {
            const nextEnd = { line: range.end.line, column: range.end.column };
            setVisualSelection(visualSelection.start, nextEnd);

            const selectionOffsets = getVisualSelectionOffsets(
              visualSelection.start,
              nextEnd,
              lines,
              currentVisualMode,
            );
            if (selectionOffsets) {
              applyTextareaSelection(selectionOffsets);
            }
          }
        }

        clearKeyBuffer();
        clearLastKey();
        return true;
      }

      switch (key) {
        case "Escape":
          e.preventDefault();
          e.stopPropagation();
          {
            const cursor = useEditorStateStore.getState().cursorPosition;
            collapseTextareaSelection(cursor.offset);
          }
          setMode("normal");
          return true;
        case ":":
          e.preventDefault();
          e.stopPropagation();
          enterCommandMode();
          return true;
        case "u":
        case "U": {
          e.preventDefault();
          e.stopPropagation();
          if (visualSelection.start && visualSelection.end) {
            const lines = useEditorViewStore.getState().lines;
            const selectionOffsets = getVisualSelectionOffsets(
              visualSelection.start,
              visualSelection.end,
              lines,
              currentVisualMode,
            );
            if (selectionOffsets) {
              const content = facade.getContent();
              const selectedText = content.slice(selectionOffsets.start, selectionOffsets.end);
              const transformed =
                key === "u" ? selectedText.toLowerCase() : selectedText.toUpperCase();
              const newContent =
                content.slice(0, selectionOffsets.start) +
                transformed +
                content.slice(selectionOffsets.end);
              facade.saveUndoState();
              facade.setContent(newContent);
              facade.collapseSelection(selectionOffsets.start);
              setCursorPosition({
                line: visualSelection.start.line,
                column: visualSelection.start.column,
                offset: selectionOffsets.start,
              });
            }
          }
          setMode("normal");
          return true;
        }
        case "d":
        case "y":
        case "c": {
          e.preventDefault();
          e.preventDefault();
          e.stopPropagation();
          // Handle operators on visual selection
          if (visualSelection.start && visualSelection.end) {
            const lines = useEditorViewStore.getState().lines;
            const selectionOffsets = getVisualSelectionOffsets(
              visualSelection.start,
              visualSelection.end,
              lines,
              currentVisualMode,
            );
            if (!selectionOffsets) {
              setMode("normal");
              return true;
            }

            if (key === "d") {
              vimEdit.deleteVisualSelection(selectionOffsets.start, selectionOffsets.end);
            } else if (key === "y") {
              vimEdit.yankVisualSelection(selectionOffsets.start, selectionOffsets.end);
            } else if (key === "c") {
              vimEdit.deleteVisualSelection(selectionOffsets.start, selectionOffsets.end);
              setMode("insert");
              return true;
            }
          }
          setMode("normal");
          return true;
        }
        case "f":
        case "F":
        case "t":
        case "T":
          e.preventDefault();
          e.stopPropagation();
          setLastKey(key);
          return true;
      }

      const applyMotion = (motionKeys: string[]): boolean => {
        const success = executeVimCommand(motionKeys);
        if (!success) {
          return false;
        }

        const newPosition = useEditorStateStore.getState().cursorPosition;
        const lines = useEditorViewStore.getState().lines;

        const { setVisualSelection } = useVimStore.use.actions();
        if (visualSelection.start) {
          const nextStart =
            currentVisualMode === "line"
              ? { line: visualSelection.start.line, column: 0 }
              : visualSelection.start;
          const nextEnd =
            currentVisualMode === "line"
              ? { line: newPosition.line, column: 0 }
              : { line: newPosition.line, column: newPosition.column };

          setVisualSelection(nextStart, nextEnd);

          const selectionOffsets = getVisualSelectionOffsets(
            nextStart,
            nextEnd,
            lines,
            currentVisualMode,
          );
          if (selectionOffsets) {
            applyTextareaSelection(selectionOffsets);
          }
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
