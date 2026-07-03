import { type RefObject, useCallback } from "react";
import { editorAPI } from "@/features/editor/extensions/api";
import { useInlineEditToolbarStore } from "@/features/editor/stores/inline-edit-toolbar.store";
import { useEditorAppStore } from "@/features/editor/stores/editor-app.store";
import type { FilteredCompletion } from "@/utils/fuzzy-matcher";
import { useLspStore } from "@/features/editor/lsp/stores/lsp.store";
import { useEditorDecorationsStore } from "@/features/editor/stores/decorations.store";
import { useFoldStore } from "@/features/editor/stores/fold.store";
import { useEditorUIStore } from "@/features/editor/stores/ui.store";
import { trackImmediateBufferHistoryChange } from "@/features/editor/stores/buffer-history-tracking";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useKeymapStore } from "@/features/keymaps/stores/keymaps.store";
import { evaluateWhenClause } from "@/features/keymaps/utils/context";
import { getEffectiveKeybindings } from "@/features/keymaps/utils/effective-keymaps";
import { matchKeybinding } from "@/features/keymaps/utils/matcher";
import { keymapRegistry } from "@/features/keymaps/utils/registry";
import type {
  Decoration,
  MultiCursorState,
  Position,
  Range,
} from "@/features/editor/types/editor.types";
import { calculateLineOffset } from "@/features/editor/utils/lines";
import { resolveMultiCursorKeyEdit } from "@/features/editor/utils/multi-cursor";
import { calculateCursorPositionFromLineOffsets } from "@/features/editor/utils/position";
import {
  resolvePostCompletionKeyEdit,
  resolvePreCompletionKeyEdit,
  type EditorKeyEditResult,
} from "@/features/editor/engines/athas/utils/editor-key-edits";
import { resolveLspCompletionKeyAction } from "@/features/editor/utils/lsp-completion-keys";
import { getLanguageId } from "./use-tokenizer";

function isAltGraphPressed(e: React.KeyboardEvent<HTMLTextAreaElement>): boolean {
  return e.getModifierState("AltGraph") || (e.ctrlKey && e.altKey && !e.metaKey);
}

function shouldTreatAltAsTextInput(e: React.KeyboardEvent<HTMLTextAreaElement>): boolean {
  if (!e.altKey || e.metaKey) return false;
  if (e.key.length !== 1) return false;
  return !e.ctrlKey || isAltGraphPressed(e);
}

function applyTextareaKeyEdit(
  event: React.KeyboardEvent<HTMLTextAreaElement>,
  textarea: HTMLTextAreaElement,
  result: EditorKeyEditResult,
  handleInput: (content: string) => void,
  setAutocompleteCompletion: (completion: { text: string; cursorOffset: number } | null) => void,
): void {
  event.preventDefault();

  if (result.type === "move-cursor") {
    textarea.selectionStart = result.selectionStart;
    textarea.selectionEnd = result.selectionEnd;
    return;
  }

  textarea.value = result.content;
  textarea.selectionStart = result.selectionStart;
  textarea.selectionEnd = result.selectionEnd;

  if (result.clearAutocomplete) {
    setAutocompleteCompletion(null);
  }

  handleInput(result.content);
}

interface UseEditorKeyDownOptions {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  content: string;
  bufferId: string | null;
  filePath: string | undefined;
  languageId?: string | null;
  tabSize: number;
  lines: string[];
  lineOffsets: number[];
  cursorPosition: Position;
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
  languageId,
  tabSize,
  lines,
  lineOffsets,
  cursorPosition,
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

      const multiCursorEdit = resolveMultiCursorKeyEdit({
        content,
        key: e.key,
        multiCursorState,
        hasBlockedModifier,
      });
      if (multiCursorEdit) {
        e.preventDefault();

        if (bufferId) {
          trackImmediateBufferHistoryChange({
            bufferId,
            currentContent: content,
            nextContent: multiCursorEdit.newContent,
            previousCursorPosition: cursorPosition,
          });
          updateBufferContent(bufferId, multiCursorEdit.newContent);
        }

        if (inputRef.current) {
          inputRef.current.value = multiCursorEdit.newContent;
        }

        for (const cursor of multiCursorEdit.newCursors) {
          updateCursor(cursor.id, cursor.position, cursor.selection);
        }

        if (multiCursorEdit.primaryCursor && inputRef.current) {
          inputRef.current.selectionStart = multiCursorEdit.primaryCursor.position.offset;
          inputRef.current.selectionEnd = multiCursorEdit.primaryCursor.position.offset;
        }

        return;
      }

      const currentLanguageId = languageId ?? (filePath ? getLanguageId(filePath) : null);
      const textarea = e.currentTarget;
      const keyState = {
        key: e.key,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        content: textarea.value,
        selectionStart: textarea.selectionStart,
        selectionEnd: textarea.selectionEnd,
        languageId: currentLanguageId,
        tabSize,
      };

      const preCompletionEdit = resolvePreCompletionKeyEdit({
        keyState,
        hasBlockedModifier,
        autocompleteCompletion,
        isLspCompletionVisible,
      });
      if (preCompletionEdit) {
        applyTextareaKeyEdit(
          e,
          textarea,
          preCompletionEdit,
          handleInput,
          setAutocompleteCompletion,
        );
        return;
      }

      const lspCompletionAction = resolveLspCompletionKeyAction({
        keyState,
        isVisible: isLspCompletionVisible,
        filteredCompletions,
        selectedIndex: selectedLspIndex,
      });
      if (lspCompletionAction) {
        e.preventDefault();

        if (lspCompletionAction.type === "select") {
          setSelectedLspIndex(lspCompletionAction.selectedIndex);
          return;
        }

        if (lspCompletionAction.type === "apply") {
          setSelectedLspIndex(lspCompletionAction.selectedIndex);
          const selectedCompletion = lspCompletionAction.completion;
          if (selectedCompletion) {
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

        if (lspCompletionAction.type === "hide") {
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

      const postCompletionEdit = resolvePostCompletionKeyEdit({
        ...keyState,
        content: textarea.value,
        selectionStart: textarea.selectionStart,
        selectionEnd: textarea.selectionEnd,
      });
      if (postCompletionEdit) {
        applyTextareaKeyEdit(
          e,
          textarea,
          postCompletionEdit,
          handleInput,
          setAutocompleteCompletion,
        );
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
      setCursorPosition,
      lines,
      lineOffsets,
      inlineEditToolbarActions,
      inlineEditVisible,
      isInlineEditRunning,
      handleApplyInlineEdit,
      inputRef,
      filePath,
      languageId,
    ],
  );
}
