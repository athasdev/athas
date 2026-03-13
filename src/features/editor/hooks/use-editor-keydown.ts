import { type RefObject, useCallback } from "react";
import { useInlineEditToolbarStore } from "@/stores/inline-edit-toolbar-store";
import { toast } from "@/ui/toast-store";
import type { FilteredCompletion } from "@/utils/fuzzy-matcher";
import { useLspStore } from "../lsp/lsp-store";
import { useEditorDecorationsStore } from "../stores/decorations-store";
import { useFoldStore } from "../stores/fold-store";
import { useEditorUIStore } from "../stores/ui-store";
import type { Decoration, MultiCursorState, Position, Range } from "../types/editor";
import { calculateLineOffset, splitLines } from "../utils/lines";
import { applyMultiCursorBackspace, applyMultiCursorEdit } from "../utils/multi-cursor";
import { calculateCursorPosition } from "../utils/position";
import { getLanguageId } from "./use-tokenizer";

const AUTO_PAIRS: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
  '"': '"',
  "'": "'",
  "`": "`",
};
const AUTO_PAIR_CLOSERS = new Set(Object.values(AUTO_PAIRS));
const BLOCK_COMMENT_LANGUAGES = new Set(["css"]);

function isAltGraphPressed(e: React.KeyboardEvent<HTMLTextAreaElement>): boolean {
  return e.getModifierState("AltGraph") || (e.ctrlKey && e.altKey && !e.metaKey);
}

interface UseEditorKeyDownOptions {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  content: string;
  bufferId: string | null;
  filePath: string | undefined;
  tabSize: number;
  lines: string[];
  cursorPosition: Position;
  selection: Range | undefined;
  multiCursorState: MultiCursorState | null;
  isLspCompletionVisible: boolean;
  filteredCompletions: FilteredCompletion[];
  selectedLspIndex: number;
  autocompleteCompletion: { text: string; cursorOffset: number } | null;
  inlineEditVisible: boolean;
  isInlineEditRunning: boolean;
  handleInput: (content: string) => void;
  handleApplyInlineEdit: () => Promise<void>;
  updateBufferContent: (bufferId: string, content: string) => void;
  setCursorPosition: (position: Position) => void;
  setSelection: (selection?: Range) => void;
  enableMultiCursor: () => void;
  addCursor: (position: Position, selection?: Range) => void;
  clearSecondaryCursors: () => void;
  updateCursor: (cursorId: string, position: Position, selection?: Range) => void;
  setSelectedLspIndex: (index: number) => void;
  setIsLspCompletionVisible: (visible: boolean) => void;
  setAutocompleteCompletion: (completion: { text: string; cursorOffset: number } | null) => void;
}

export function useEditorKeyDown({
  inputRef,
  content,
  bufferId,
  filePath,
  tabSize,
  lines,
  cursorPosition,
  selection,
  multiCursorState,
  isLspCompletionVisible,
  filteredCompletions,
  selectedLspIndex,
  autocompleteCompletion,
  inlineEditVisible,
  isInlineEditRunning,
  handleInput,
  handleApplyInlineEdit,
  updateBufferContent,
  setCursorPosition,
  setSelection,
  enableMultiCursor,
  addCursor,
  clearSecondaryCursors,
  updateCursor,
  setSelectedLspIndex,
  setIsLspCompletionVisible,
  setAutocompleteCompletion,
}: UseEditorKeyDownOptions) {
  const inlineEditToolbarActions = useInlineEditToolbarStore.use.actions();
  const lspActions = useLspStore.use.actions();

  return useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const isAltGraph = isAltGraphPressed(e);
      const hasBlockedModifier =
        e.metaKey || (e.ctrlKey && !isAltGraph) || (e.altKey && !isAltGraph);
      const hasTextSelection = Boolean(
        selection && selection.start.offset !== selection.end.offset,
      );
      const isInlineEditShortcut =
        (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "i";

      if (isInlineEditShortcut) {
        e.preventDefault();
        if (!hasTextSelection) {
          toast.warning("Select non-empty code before inline edit.");
          return;
        }
        inlineEditToolbarActions.show();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && inlineEditVisible) {
        e.preventDefault();
        void handleApplyInlineEdit();
        return;
      }

      if (e.key === "Escape" && inlineEditVisible) {
        e.preventDefault();
        if (isInlineEditRunning) return;
        inlineEditToolbarActions.hide();
        return;
      }

      if (!isAltGraph && e.altKey && (e.key === "[" || e.key === "]")) {
        e.preventDefault();
        const decorations = useEditorDecorationsStore.getState().decorations;
        const changedLines: number[] = [];

        decorations.forEach((dec: Decoration & { id: string }) => {
          if (dec.type === "gutter" && dec.className?.includes("git-gutter")) {
            changedLines.push(dec.range.start.line);
          }
        });

        if (changedLines.length === 0) return;

        changedLines.sort((a, b) => a - b);

        const currentLine = cursorPosition.line;

        if (e.key === "]") {
          const nextChange = changedLines.find((line) => line > currentLine);
          if (nextChange !== undefined) {
            const lineStart = calculateLineOffset(lines, nextChange);
            if (inputRef.current) {
              inputRef.current.selectionStart = lineStart;
              inputRef.current.selectionEnd = lineStart;
              inputRef.current.focus();
            }
            setCursorPosition(calculateCursorPosition(lineStart, lines));
          }
        } else {
          const prevChanges = changedLines.filter((line) => line < currentLine);
          if (prevChanges.length > 0) {
            const prevChange = prevChanges[prevChanges.length - 1];
            const lineStart = calculateLineOffset(lines, prevChange);
            if (inputRef.current) {
              inputRef.current.selectionStart = lineStart;
              inputRef.current.selectionEnd = lineStart;
              inputRef.current.focus();
            }
            setCursorPosition(calculateCursorPosition(lineStart, lines));
          }
        }
        return;
      }

      // Cmd+Shift+[ to fold, Cmd+Shift+] to unfold at cursor
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "[" || e.key === "]")) {
        e.preventDefault();
        const foldStoreActions = useFoldStore.getState().actions;
        if (!filePath) return;

        if (e.key === "[") {
          if (foldStoreActions.isFoldable(filePath, cursorPosition.line)) {
            foldStoreActions.toggleFold(filePath, cursorPosition.line);
          }
        } else {
          if (foldStoreActions.isCollapsed(filePath, cursorPosition.line)) {
            foldStoreActions.toggleFold(filePath, cursorPosition.line);
          }
        }
        return;
      }

      // Shift+Alt+Down/Up for column cursors
      if (!isAltGraph && e.shiftKey && e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault();

        const contentLines = splitLines(content);
        const targetLine =
          e.key === "ArrowDown" ? cursorPosition.line + 1 : cursorPosition.line - 1;

        if (targetLine < 0 || targetLine >= contentLines.length) return;

        const targetLineText = contentLines[targetLine] || "";
        const targetColumn = Math.min(cursorPosition.column, targetLineText.length);

        let offset = 0;
        for (let i = 0; i < targetLine; i++) {
          offset += (contentLines[i]?.length || 0) + 1;
        }
        offset += targetColumn;

        const newPosition: Position = {
          line: targetLine,
          column: targetColumn,
          offset,
        };

        if (!multiCursorState) {
          enableMultiCursor();
        }
        addCursor(newPosition);
        return;
      }

      // Cmd+D to select next occurrence
      if ((e.metaKey || e.ctrlKey) && e.key === "d") {
        e.preventDefault();

        let searchText = "";
        let selectionStart = inputRef.current?.selectionStart || 0;
        let selectionEnd = inputRef.current?.selectionEnd || 0;

        if (selectionStart !== selectionEnd) {
          searchText = content.substring(selectionStart, selectionEnd);
        } else {
          const contentLines = splitLines(content);
          const lineText = contentLines[cursorPosition.line] || "";
          const wordRegex = /[a-zA-Z0-9_]+/g;
          let match: RegExpExecArray | null;

          match = wordRegex.exec(lineText);
          while (match !== null) {
            const wordStart = match.index;
            const wordEnd = match.index + match[0].length;
            if (cursorPosition.column >= wordStart && cursorPosition.column <= wordEnd) {
              searchText = match[0];
              let lineOffset = 0;
              for (let i = 0; i < cursorPosition.line; i++) {
                lineOffset += (contentLines[i]?.length || 0) + 1;
              }
              selectionStart = lineOffset + wordStart;
              selectionEnd = lineOffset + wordEnd;
              break;
            }
            match = wordRegex.exec(lineText);
          }
        }

        if (!searchText) return;

        const searchIndex = content.indexOf(searchText, selectionEnd);
        if (searchIndex === -1) return;

        const contentLines = splitLines(content);
        let line = 0;
        let currentOffset = 0;
        for (let i = 0; i < contentLines.length; i++) {
          const lineLen = contentLines[i].length + 1;
          if (currentOffset + lineLen > searchIndex) {
            line = i;
            break;
          }
          currentOffset += lineLen;
        }
        const column = searchIndex - currentOffset;
        const endColumn = column + searchText.length;

        const newPosition: Position = {
          line,
          column: endColumn,
          offset: searchIndex + searchText.length,
        };

        const newSelection: Range = {
          start: { line, column, offset: searchIndex },
          end: { line, column: endColumn, offset: searchIndex + searchText.length },
        };

        if (!multiCursorState) {
          enableMultiCursor();
          if (inputRef.current) {
            inputRef.current.selectionStart = selectionStart;
            inputRef.current.selectionEnd = selectionEnd;
          }
        }
        addCursor(newPosition, newSelection);
        return;
      }

      if (multiCursorState && multiCursorState.cursors.length > 1) {
        if (e.key === "Backspace") {
          e.preventDefault();

          const { newContent, newCursors } = applyMultiCursorBackspace(
            content,
            multiCursorState.cursors,
          );

          if (bufferId) {
            updateBufferContent(bufferId, newContent);
          }

          if (inputRef.current) {
            inputRef.current.value = newContent;
          }

          for (const cursor of newCursors) {
            updateCursor(cursor.id, cursor.position, cursor.selection);
          }

          const primaryCursor = newCursors.find((c) => c.id === multiCursorState.primaryCursorId);
          if (primaryCursor && inputRef.current) {
            inputRef.current.selectionStart = primaryCursor.position.offset;
            inputRef.current.selectionEnd = primaryCursor.position.offset;
          }

          return;
        }

        if (e.key.length === 1 || e.key === "Enter") {
          e.preventDefault();

          const text = e.key === "Enter" ? "\n" : e.key;
          const { newContent, newCursors } = applyMultiCursorEdit(
            content,
            multiCursorState.cursors,
            text,
          );

          if (bufferId) {
            updateBufferContent(bufferId, newContent);
          }

          if (inputRef.current) {
            inputRef.current.value = newContent;
          }

          for (const cursor of newCursors) {
            updateCursor(cursor.id, cursor.position, cursor.selection);
          }

          const primaryCursor = newCursors.find((c) => c.id === multiCursorState.primaryCursorId);
          if (primaryCursor && inputRef.current) {
            inputRef.current.selectionStart = primaryCursor.position.offset;
            inputRef.current.selectionEnd = primaryCursor.position.offset;
          }

          return;
        }
      }

      // Auto-pairing for single cursor editing
      if (inputRef.current && !hasBlockedModifier) {
        const textarea = e.currentTarget;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const currentContent = textarea.value;
        const selectedText = currentContent.substring(start, end);
        const nextChar = currentContent[start] || "";
        const prevChar = start > 0 ? currentContent[start - 1] : "";
        const currentLanguageId = filePath ? getLanguageId(filePath) : null;

        // CSS block comment expansion: typing * after / becomes /* */
        if (
          e.key === "*" &&
          start === end &&
          prevChar === "/" &&
          currentLanguageId &&
          BLOCK_COMMENT_LANGUAGES.has(currentLanguageId)
        ) {
          e.preventDefault();
          const insertText = "* */";
          const newContent =
            currentContent.substring(0, start) + insertText + currentContent.substring(end);
          const newCursorPos = start + 2;

          textarea.value = newContent;
          textarea.selectionStart = textarea.selectionEnd = newCursorPos;
          handleInput(newContent);
          return;
        }

        // Skip over existing closer if user types the same closer
        if (
          e.key.length === 1 &&
          start === end &&
          AUTO_PAIR_CLOSERS.has(e.key) &&
          nextChar === e.key
        ) {
          e.preventDefault();
          textarea.selectionStart = textarea.selectionEnd = start + 1;
          return;
        }

        // Auto-insert closing pair (also wraps selection)
        const closingPair = AUTO_PAIRS[e.key];
        if (e.key.length === 1 && closingPair) {
          if (e.key === "'" && /\w/.test(prevChar)) {
            return;
          }

          e.preventDefault();
          const newContent =
            currentContent.substring(0, start) +
            e.key +
            selectedText +
            closingPair +
            currentContent.substring(end);
          const newCursorPos = start + 1;
          const newSelectionEnd = start + 1 + selectedText.length;

          textarea.value = newContent;
          if (selectedText.length > 0) {
            textarea.selectionStart = newCursorPos;
            textarea.selectionEnd = newSelectionEnd;
          } else {
            textarea.selectionStart = textarea.selectionEnd = newCursorPos;
          }
          handleInput(newContent);
          return;
        }

        // Delete pair together when backspacing between pairs
        if (e.key === "Backspace" && start === end && start > 0) {
          const leftChar = currentContent[start - 1];
          const rightChar = currentContent[start] || "";
          const expectedRight = AUTO_PAIRS[leftChar];

          if (expectedRight && rightChar === expectedRight) {
            e.preventDefault();
            const newContent =
              currentContent.substring(0, start - 1) + currentContent.substring(start + 1);
            const newCursorPos = start - 1;
            textarea.value = newContent;
            textarea.selectionStart = textarea.selectionEnd = newCursorPos;
            handleInput(newContent);
            return;
          }
        }
      }

      if (
        autocompleteCompletion &&
        !isLspCompletionVisible &&
        e.key === "Tab" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        const textarea = e.currentTarget;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;

        if (start === end && start === autocompleteCompletion.cursorOffset) {
          e.preventDefault();

          const currentContent = textarea.value;
          const newContent =
            currentContent.substring(0, start) +
            autocompleteCompletion.text +
            currentContent.substring(end);
          const newCursorPos = start + autocompleteCompletion.text.length;

          textarea.value = newContent;
          textarea.selectionStart = textarea.selectionEnd = newCursorPos;

          setAutocompleteCompletion(null);
          handleInput(newContent);
          return;
        }
      }

      if (isLspCompletionVisible && filteredCompletions.length > 0) {
        const maxIndex = filteredCompletions.length;

        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedLspIndex(selectedLspIndex < maxIndex - 1 ? selectedLspIndex + 1 : 0);
          return;
        }

        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedLspIndex(selectedLspIndex > 0 ? selectedLspIndex - 1 : maxIndex - 1);
          return;
        }

        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          const selectedCompletion = filteredCompletions[selectedLspIndex]?.item;
          if (selectedCompletion) {
            const textarea = e.currentTarget;
            const currentContent = textarea.value;
            const cursorPos = textarea.selectionStart;

            const result = lspActions.applyCompletion({
              completion: selectedCompletion,
              value: currentContent,
              cursorPos,
            });

            textarea.value = result.newValue;
            textarea.selectionStart = textarea.selectionEnd = result.newCursorPos;

            handleInput(result.newValue);

            setTimeout(() => {
              useEditorUIStore.getState().actions.setIsApplyingCompletion(false);
            }, 0);
          }
          return;
        }

        if (e.key === "Escape") {
          e.preventDefault();
          setIsLspCompletionVisible(false);
          return;
        }
      }

      if (e.key === "Escape" && multiCursorState && multiCursorState.cursors.length > 1) {
        e.preventDefault();
        clearSecondaryCursors();
        return;
      }

      if (e.key === "Escape" && autocompleteCompletion) {
        e.preventDefault();
        setAutocompleteCompletion(null);
        return;
      }

      if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        const textarea = e.currentTarget;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const currentContent = textarea.value;

        const lineStart = currentContent.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
        const currentLinePrefix = currentContent.slice(lineStart, start);
        const indentMatch = currentLinePrefix.match(/^[\t ]*/);
        const indent = indentMatch?.[0] ?? "";

        const inserted = `\n${indent}`;
        const newContent =
          currentContent.substring(0, start) + inserted + currentContent.substring(end);
        const newCursorPos = start + inserted.length;

        textarea.value = newContent;
        textarea.selectionStart = textarea.selectionEnd = newCursorPos;

        handleInput(newContent);
        return;
      }

      if (e.key === "Tab") {
        if (e.ctrlKey || e.metaKey) {
          return;
        }

        e.preventDefault();
        const textarea = e.currentTarget;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const spaces = " ".repeat(tabSize);
        const currentContent = textarea.value;

        const newContent =
          currentContent.substring(0, start) + spaces + currentContent.substring(end);

        textarea.value = newContent;

        textarea.selectionStart = textarea.selectionEnd = start + spaces.length;

        handleInput(newContent);
      }
    },
    [
      tabSize,
      handleInput,
      isLspCompletionVisible,
      autocompleteCompletion,
      filteredCompletions,
      selectedLspIndex,
      setSelectedLspIndex,
      setIsLspCompletionVisible,
      setAutocompleteCompletion,
      lspActions,
      multiCursorState,
      clearSecondaryCursors,
      content,
      bufferId,
      updateBufferContent,
      updateCursor,
      cursorPosition.line,
      cursorPosition.column,
      setCursorPosition,
      lines,
      selection,
      inlineEditToolbarActions,
      inlineEditVisible,
      isInlineEditRunning,
      handleApplyInlineEdit,
      inputRef,
      filePath,
      enableMultiCursor,
      addCursor,
      setSelection,
    ],
  );
}
