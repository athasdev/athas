import { type RefObject, useCallback } from "react";
import { editorAPI } from "../extensions/api";
import { useInlineEditToolbarStore } from "@/features/editor/stores/inline-edit-toolbar-store";
import { useEditorAppStore } from "../stores/editor-app-store";
import type { FilteredCompletion } from "@/utils/fuzzy-matcher";
import { useLspStore } from "../lsp/lsp-store";
import { useEditorDecorationsStore } from "../stores/decorations-store";
import { useFoldStore } from "../stores/fold-store";
import { useEditorUIStore } from "../stores/ui-store";
import { useSettingsStore } from "@/features/settings/store";
import { useKeymapStore } from "@/features/keymaps/stores/store";
import { evaluateWhenClause } from "@/features/keymaps/utils/context";
import { getEffectiveKeybindings } from "@/features/keymaps/utils/effective-keymaps";
import { matchKeybinding } from "@/features/keymaps/utils/matcher";
import { keymapRegistry } from "@/features/keymaps/utils/registry";
import type { Decoration, MultiCursorState, Position, Range } from "../types/editor";
import { calculateLineOffset } from "../utils/lines";
import { applyMultiCursorBackspace, applyMultiCursorEdit } from "../utils/multi-cursor";
import { calculateCursorPositionFromLineOffsets } from "../utils/position";
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
const BLOCK_COMMENT_LANGUAGES = new Set([
  "c",
  "cpp",
  "csharp",
  "css",
  "dart",
  "go",
  "java",
  "javascript",
  "javascriptreact",
  "php",
  "rust",
  "scala",
  "swift",
  "typescript",
  "typescriptreact",
]);
const LINE_COMMENT_TOKENS: Partial<Record<string, string>> = {
  bash: "#",
  c: "//",
  cpp: "//",
  csharp: "//",
  dart: "//",
  dotenv: "#",
  elixir: "#",
  go: "//",
  java: "//",
  javascript: "//",
  javascriptreact: "//",
  kotlin: "//",
  lua: "--",
  php: "//",
  python: "#",
  ruby: "#",
  rust: "//",
  scala: "//",
  shell: "#",
  sql: "--",
  swift: "//",
  typescript: "//",
  typescriptreact: "//",
  yaml: "#",
  toml: "#",
  zig: "//",
};

function isAltGraphPressed(e: React.KeyboardEvent<HTMLTextAreaElement>): boolean {
  return e.getModifierState("AltGraph") || (e.ctrlKey && e.altKey && !e.metaKey);
}

function shouldTreatAltAsTextInput(e: React.KeyboardEvent<HTMLTextAreaElement>): boolean {
  if (!e.altKey || e.metaKey) return false;
  if (e.key.length !== 1) return false;
  return !e.ctrlKey || isAltGraphPressed(e);
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeRange(range: Range): Range {
  return range.start.offset <= range.end.offset ? range : { start: range.end, end: range.start };
}

function rangesOverlap(start: number, end: number, ranges: Range[]): boolean {
  return ranges.some((range) => {
    const normalized = normalizeRange(range);
    return start < normalized.end.offset && end > normalized.start.offset;
  });
}

function getLineCommentToken(languageId: string | null): string | null {
  if (!languageId) return null;
  return LINE_COMMENT_TOKENS[languageId] || null;
}

function getCommentContinuation(
  languageId: string | null,
  linePrefix: string,
  lineSuffix: string,
): { insertText: string; cursorOffset: number } | null {
  const indentMatch = linePrefix.match(/^[\t ]*/);
  const indent = indentMatch?.[0] ?? "";
  const trimmedPrefix = linePrefix.trimStart();
  const trimmedSuffix = lineSuffix.trim();

  if (languageId && BLOCK_COMMENT_LANGUAGES.has(languageId)) {
    const openingBlockMatch = trimmedPrefix.match(/^\/\*\*?(?:\s.*)?$/);
    const starLineMatch = trimmedPrefix.match(/^\*(?:\s.*)?$/);
    const isInlineBlockPair =
      (trimmedPrefix === "/*" || trimmedPrefix === "/**") &&
      (lineSuffix.startsWith(" */") || lineSuffix.startsWith("*/"));

    if (isInlineBlockPair) {
      const insertText = `\n${indent} * \n${indent}`;
      return {
        insertText,
        cursorOffset: insertText.length - (indent.length + 1),
      };
    }

    if (openingBlockMatch || starLineMatch) {
      const insertText = `\n${indent} * `;
      return {
        insertText,
        cursorOffset: insertText.length,
      };
    }
  }

  const lineCommentToken = getLineCommentToken(languageId);
  if (!lineCommentToken) {
    return null;
  }

  const lineCommentPattern = new RegExp(
    `^([\\t ]*)${escapeForRegex(lineCommentToken)}(?:\\s?(.*))?$`,
  );
  const lineCommentMatch = linePrefix.match(lineCommentPattern);
  if (!lineCommentMatch) {
    return null;
  }

  const commentIndent = lineCommentMatch[1] ?? indent;
  const commentBody = lineCommentMatch[2] ?? "";

  if (commentBody.length === 0 && trimmedSuffix.length === 0) {
    return null;
  }

  const insertText = `\n${commentIndent}${lineCommentToken} `;
  return {
    insertText,
    cursorOffset: insertText.length,
  };
}

interface UseEditorKeyDownOptions {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  content: string;
  bufferId: string | null;
  filePath: string | undefined;
  tabSize: number;
  lines: string[];
  lineOffsets: number[];
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
  lineOffsets,
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
      const isAltTextInput = shouldTreatAltAsTextInput(e);
      const hasBlockedModifier =
        e.metaKey || (e.ctrlKey && !isAltGraph) || (e.altKey && !isAltGraph && !isAltTextInput);

      // Cmd/Ctrl+D follows the editor's multi-cursor model, so handle it before
      // the global keymap resolver can route it to generic duplicate-line commands.
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        e.stopPropagation();

        const textarea = inputRef.current;
        if (!textarea || content.length === 0) return;

        const existingSelections =
          multiCursorState?.cursors
            .map((cursor) => cursor.selection)
            .filter((cursorSelection): cursorSelection is Range => !!cursorSelection)
            .map(normalizeRange) ?? [];
        let selectedRanges = existingSelections;
        let searchText = "";
        let searchFrom = 0;
        let firstRange: Range | null = null;

        if (selectedRanges.length > 0) {
          const sortedRanges = [...selectedRanges].sort((a, b) => a.start.offset - b.start.offset);
          firstRange = sortedRanges[0];
          searchText = content.slice(firstRange.start.offset, firstRange.end.offset);
          searchFrom = Math.max(...sortedRanges.map((range) => range.end.offset));
        } else {
          let selectionStart = Math.min(textarea.selectionStart, textarea.selectionEnd);
          let selectionEnd = Math.max(textarea.selectionStart, textarea.selectionEnd);
          const hadSelection = selectionStart !== selectionEnd;

          if (selectionStart === selectionEnd) {
            const lineText = lines[cursorPosition.line] || "";
            const wordRegex = /[a-zA-Z0-9_]+/g;
            let match: RegExpExecArray | null;

            match = wordRegex.exec(lineText);
            while (match !== null) {
              const wordStart = match.index;
              const wordEnd = match.index + match[0].length;
              if (cursorPosition.column >= wordStart && cursorPosition.column <= wordEnd) {
                const lineOffset =
                  lineOffsets[cursorPosition.line] ??
                  calculateLineOffset(lines, cursorPosition.line);
                selectionStart = lineOffset + wordStart;
                selectionEnd = lineOffset + wordEnd;
                break;
              }
              match = wordRegex.exec(lineText);
            }
          }

          if (selectionStart === selectionEnd) return;

          searchText = content.slice(selectionStart, selectionEnd);
          firstRange = {
            start: calculateCursorPositionFromLineOffsets(selectionStart, lines, lineOffsets),
            end: calculateCursorPositionFromLineOffsets(selectionEnd, lines, lineOffsets),
          };
          selectedRanges = [firstRange];
          searchFrom = selectionEnd;

          textarea.selectionStart = selectionStart;
          textarea.selectionEnd = selectionEnd;
          setCursorPosition(firstRange.end);
          setSelection(firstRange);

          if (!hadSelection) return;
        }

        if (!searchText || !firstRange) return;

        const findNextMatch = (startOffset: number, wrap: boolean) => {
          let index = content.indexOf(searchText, startOffset);
          const step = Math.max(searchText.length, 1);

          while (index !== -1) {
            const end = index + searchText.length;
            if (!rangesOverlap(index, end, selectedRanges)) {
              return index;
            }
            index = content.indexOf(searchText, index + step);
          }

          if (!wrap || startOffset === 0) return -1;

          index = content.indexOf(searchText, 0);
          while (index !== -1 && index < startOffset) {
            const end = index + searchText.length;
            if (!rangesOverlap(index, end, selectedRanges)) {
              return index;
            }
            index = content.indexOf(searchText, index + step);
          }

          return -1;
        };

        const searchIndex = findNextMatch(searchFrom, true);
        if (searchIndex === -1) return;

        const matchStart = calculateCursorPositionFromLineOffsets(searchIndex, lines, lineOffsets);
        const matchEnd = calculateCursorPositionFromLineOffsets(
          searchIndex + searchText.length,
          lines,
          lineOffsets,
        );
        const newSelection: Range = {
          start: matchStart,
          end: matchEnd,
        };

        if (!multiCursorState) {
          enableMultiCursor();
        }
        addCursor(matchEnd, newSelection);
        return;
      }

      if (hasBlockedModifier && !useSettingsStore.getState().settings.nativeMenuBar) {
        const contexts = useKeymapStore.getState().contexts;
        const registryKeybindings = keymapRegistry.getAllKeybindings();
        const userKeybindings = useKeymapStore.getState().keybindings;
        const allKeybindings = getEffectiveKeybindings({
          preset: useSettingsStore.getState().settings.keybindingPreset,
          registryKeybindings,
          userKeybindings,
        });

        for (const keybinding of allKeybindings) {
          if (!keybinding.enabled && keybinding.enabled !== undefined) {
            continue;
          }

          if (keybinding.when && !evaluateWhenClause(keybinding.when, contexts)) {
            continue;
          }

          const matchResult = matchKeybinding(e.nativeEvent, keybinding.key, []);
          if (!matchResult.matched || matchResult.partialMatch) {
            continue;
          }

          e.preventDefault();
          e.stopPropagation();
          keymapRegistry.executeCommand(keybinding.command, keybinding.args);
          return;
        }
      }

      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        e.stopPropagation();
        void useEditorAppStore.getState().actions.handleSave();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.stopPropagation();

        if (e.shiftKey) {
          editorAPI.redo();
        } else {
          editorAPI.undo();
        }
        return;
      }

      if (e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "y") {
        e.preventDefault();
        e.stopPropagation();
        editorAPI.redo();
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

      if (!isAltGraph && !isAltTextInput && e.altKey && (e.key === "[" || e.key === "]")) {
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
            const lineStart = lineOffsets[nextChange] ?? calculateLineOffset(lines, nextChange);
            if (inputRef.current) {
              inputRef.current.selectionStart = lineStart;
              inputRef.current.selectionEnd = lineStart;
              inputRef.current.focus();
            }
            setCursorPosition(
              calculateCursorPositionFromLineOffsets(lineStart, lines, lineOffsets),
            );
          }
        } else {
          const prevChanges = changedLines.filter((line) => line < currentLine);
          if (prevChanges.length > 0) {
            const prevChange = prevChanges[prevChanges.length - 1];
            const lineStart = lineOffsets[prevChange] ?? calculateLineOffset(lines, prevChange);
            if (inputRef.current) {
              inputRef.current.selectionStart = lineStart;
              inputRef.current.selectionEnd = lineStart;
              inputRef.current.focus();
            }
            setCursorPosition(
              calculateCursorPositionFromLineOffsets(lineStart, lines, lineOffsets),
            );
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

        const targetLine =
          e.key === "ArrowDown" ? cursorPosition.line + 1 : cursorPosition.line - 1;

        if (targetLine < 0 || targetLine >= lines.length) return;

        const targetLineText = lines[targetLine] || "";
        const targetColumn = Math.min(cursorPosition.column, targetLineText.length);
        const offset =
          (lineOffsets[targetLine] ?? calculateLineOffset(lines, targetLine)) + targetColumn;

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

      const currentLanguageId = filePath ? getLanguageId(filePath) : null;

      // Auto-pairing for single cursor editing
      if (inputRef.current && !hasBlockedModifier) {
        const textarea = e.currentTarget;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const currentContent = textarea.value;
        const selectedText = currentContent.substring(start, end);
        const nextChar = currentContent[start] || "";
        const prevChar = start > 0 ? currentContent[start - 1] : "";

        // Block comment expansion: typing * after / becomes /* */
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
        const lineEnd = currentContent.indexOf("\n", start);
        const currentLinePrefix = currentContent.slice(lineStart, start);
        const currentLineSuffix =
          lineEnd === -1 ? currentContent.slice(start) : currentContent.slice(start, lineEnd);
        const indentMatch = currentLinePrefix.match(/^[\t ]*/);
        const indent = indentMatch?.[0] ?? "";

        const commentContinuation = getCommentContinuation(
          currentLanguageId,
          currentLinePrefix,
          currentLineSuffix,
        );
        const inserted = commentContinuation?.insertText ?? `\n${indent}`;
        const newContent =
          currentContent.substring(0, start) + inserted + currentContent.substring(end);
        const newCursorPos = start + (commentContinuation?.cursorOffset ?? inserted.length);

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
      lineOffsets,
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
