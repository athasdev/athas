import {
  type ChangeEvent,
  type FormEvent,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useRef,
} from "react";
import { editorAPI } from "@/features/editor/extensions/api";
import type { FoldTransformResult } from "./use-fold-transform";
import { useEditorUIStore } from "@/features/editor/stores/ui.store";
import { applyIncrementalLineEdit } from "@/features/editor/stores/view.store";
import type { Position, Range } from "@/features/editor/types/editor.types";
import { applyVirtualEdit } from "@/features/athas-editor/utils/fold-transformer";
import { applyIncrementalLineOffsetEdit } from "@/features/athas-editor/utils/html";
import {
  calculateCursorPositionFromContent,
  calculateCursorPositionFromLineOffsets,
  calculateOffsetFromContentPosition,
} from "@/features/athas-editor/utils/position";
import { getTextareaSelectionFocusOffset } from "@/features/athas-editor/utils/selection-ranges";

type EditorContentChangeHandler = (
  value: string,
  previousValue?: string,
  previousCursorPosition?: Position,
  previousSelection?: Range,
  options?: { contentAlreadyApplied?: boolean; skipUndoGrouping?: boolean },
) => void;

type ExternalContentChangeHandler = (
  content: string,
  previousContent?: string,
  previousCursorPosition?: Position,
  previousSelection?: Range,
) => void;

interface UseEditorTextareaInputParams {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  bufferId: string | null;
  readOnly: boolean;
  largeContentMode: boolean;
  useGlobalEditorState: boolean;
  content: string;
  displayContent: string;
  textareaContent: string;
  lines: string[];
  actualLines: string[];
  displayLineOffsets: number[];
  cursorPosition: Position;
  selection?: Range;
  foldTransform: FoldTransformResult;
  getInputOffsetForPosition: (position: Position) => number;
  updateBufferContent: (bufferId: string, content: string) => void;
  onContentChange?: ExternalContentChangeHandler;
  onChange: EditorContentChangeHandler;
  setCursorPosition: (position: Position) => void;
  setSelection: (selection?: Range) => void;
}

export function useEditorTextareaInput({
  inputRef,
  bufferId,
  readOnly,
  largeContentMode,
  useGlobalEditorState,
  content,
  displayContent,
  textareaContent,
  lines,
  actualLines,
  displayLineOffsets,
  cursorPosition,
  selection,
  foldTransform,
  getInputOffsetForPosition,
  updateBufferContent,
  onContentChange,
  onChange,
  setCursorPosition,
  setSelection,
}: UseEditorTextareaInputParams) {
  const suppressedNativeHistoryInputRef = useRef<"historyUndo" | "historyRedo" | null>(null);

  useLayoutEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;

    const previousScrollTop = textarea.scrollTop;
    const previousScrollLeft = textarea.scrollLeft;
    const valueChanged = textarea.value !== textareaContent;

    if (valueChanged) {
      textarea.value = textareaContent;
    }

    if (largeContentMode) {
      if (valueChanged) {
        textarea.scrollTop = previousScrollTop;
        textarea.scrollLeft = previousScrollLeft;
      }
      return;
    }

    const selectionStart = selection
      ? getInputOffsetForPosition(selection.start)
      : getInputOffsetForPosition(cursorPosition);
    const selectionEnd = selection ? getInputOffsetForPosition(selection.end) : selectionStart;

    if (textarea.selectionStart !== selectionStart || textarea.selectionEnd !== selectionEnd) {
      textarea.setSelectionRange(selectionStart, selectionEnd, "forward");
    }

    if (valueChanged) {
      textarea.scrollTop = previousScrollTop;
      textarea.scrollLeft = previousScrollLeft;
    }
  }, [
    cursorPosition,
    getInputOffsetForPosition,
    inputRef,
    largeContentMode,
    selection,
    textareaContent,
  ]);

  const handleInput = useCallback(
    (newVirtualContent: string, event?: ChangeEvent<HTMLTextAreaElement>) => {
      if (readOnly) return;
      if (!bufferId || !inputRef.current) return;

      const inputType = event ? (event.nativeEvent as InputEvent).inputType : undefined;
      if (inputType === "historyUndo" || inputType === "historyRedo") {
        inputRef.current.value = displayContent;

        if (suppressedNativeHistoryInputRef.current === inputType) {
          suppressedNativeHistoryInputRef.current = null;
          return;
        }

        if (inputType === "historyUndo") {
          editorAPI.undo();
        } else {
          editorAPI.redo();
        }
        return;
      }

      const uiActions = useEditorUIStore.getState().actions;
      uiActions.clearTypingTransientState();

      const selectionStart = inputRef.current.selectionStart;
      const selectionEnd = inputRef.current.selectionEnd;
      const focusOffset = getTextareaSelectionFocusOffset(inputRef.current);
      const newActualContent = foldTransform.hasActiveFolds
        ? applyVirtualEdit(content, newVirtualContent, foldTransform.mapping, actualLines)
        : newVirtualContent;

      const previousActualContent = content;
      const previousCursorPosition = cursorPosition;
      const previousSelection = selection;

      updateBufferContent(bufferId, newActualContent);
      if (onContentChange) {
        onContentChange(
          newActualContent,
          previousActualContent,
          previousCursorPosition,
          previousSelection,
        );
      } else {
        onChange(
          newActualContent,
          previousActualContent,
          previousCursorPosition,
          previousSelection,
          { contentAlreadyApplied: true },
        );
      }

      if (!useGlobalEditorState) return;

      const nextVirtualLineOffsets = applyIncrementalLineOffsetEdit(
        displayContent,
        newVirtualContent,
        displayLineOffsets,
      );
      const nextVirtualLines = nextVirtualLineOffsets
        ? applyIncrementalLineEdit(displayContent, newVirtualContent, lines)
        : null;
      const getNextVirtualPosition = (offset: number) =>
        nextVirtualLineOffsets && nextVirtualLines
          ? calculateCursorPositionFromLineOffsets(offset, nextVirtualLines, nextVirtualLineOffsets)
          : calculateCursorPositionFromContent(offset, newVirtualContent);
      const position = getNextVirtualPosition(focusOffset);

      if (foldTransform.hasActiveFolds) {
        const actualLine =
          foldTransform.mapping.virtualToActual.get(position.line) ?? position.line;
        setCursorPosition({
          line: actualLine,
          column: position.column,
          offset: calculateOffsetFromContentPosition(newActualContent, actualLine, position.column),
        });
      } else {
        setCursorPosition(position);
      }

      if (selectionStart !== selectionEnd) {
        const startPos = getNextVirtualPosition(selectionStart);
        const endPos = getNextVirtualPosition(selectionEnd);

        if (foldTransform.hasActiveFolds) {
          const actualStartLine =
            foldTransform.mapping.virtualToActual.get(startPos.line) ?? startPos.line;
          const actualEndLine =
            foldTransform.mapping.virtualToActual.get(endPos.line) ?? endPos.line;

          setSelection({
            start: {
              line: actualStartLine,
              column: startPos.column,
              offset: calculateOffsetFromContentPosition(
                newActualContent,
                actualStartLine,
                startPos.column,
              ),
            },
            end: {
              line: actualEndLine,
              column: endPos.column,
              offset: calculateOffsetFromContentPosition(
                newActualContent,
                actualEndLine,
                endPos.column,
              ),
            },
          });
        } else {
          setSelection({ start: startPos, end: endPos });
        }
      } else {
        setSelection(undefined);
      }

      const timestamp = Date.now();
      useEditorUIStore.getState().actions.setLastInputTimestamp(timestamp);
    },
    [
      actualLines,
      bufferId,
      content,
      cursorPosition,
      displayContent,
      displayLineOffsets,
      foldTransform,
      inputRef,
      lines,
      onChange,
      onContentChange,
      readOnly,
      selection,
      setCursorPosition,
      setSelection,
      updateBufferContent,
      useGlobalEditorState,
    ],
  );

  const handleBeforeInput = useCallback((event: FormEvent<HTMLTextAreaElement>) => {
    const inputEvent = event.nativeEvent as InputEvent;

    if (inputEvent.inputType !== "historyUndo" && inputEvent.inputType !== "historyRedo") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    suppressedNativeHistoryInputRef.current = inputEvent.inputType;

    if (inputEvent.inputType === "historyUndo") {
      editorAPI.undo();
    } else {
      editorAPI.redo();
    }
  }, []);

  return {
    handleInput,
    handleBeforeInput,
  };
}
