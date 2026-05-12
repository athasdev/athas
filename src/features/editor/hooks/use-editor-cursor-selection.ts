import { useCallback, type RefObject } from "react";
import type { FoldTransformResult } from "./use-fold-transform";
import { useEditorUIStore } from "../stores/ui-store";
import type { Position, Range } from "../types/editor";
import { calculateActualOffset } from "../utils/fold-transformer";
import {
  getTextareaSelectionAnchorOffset,
  getTextareaSelectionFocusOffset,
} from "../utils/selection-ranges";

type VimVisualSelection = {
  start: { line: number; column: number } | null;
  end: { line: number; column: number } | null;
};

interface UseEditorCursorSelectionParams {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  bufferId: string | null;
  actualLines: string[];
  foldTransform: FoldTransformResult;
  vimModeEnabled: boolean;
  vimMode: string;
  vimVisualSelection: VimVisualSelection;
  inlineEditVisible: boolean;
  getCursorPositionForVisualOffset: (offset: number) => Position;
  getVisualLineOffset: (lineIndex: number) => number;
  setCursorPosition: (position: Position) => void;
  setSelection: (selection?: Range) => void;
  setInlineEditSelectionAnchor: (anchor: { line: number; column: number } | null) => void;
}

export function useEditorCursorSelection({
  inputRef,
  bufferId,
  actualLines,
  foldTransform,
  vimModeEnabled,
  vimMode,
  vimVisualSelection,
  inlineEditVisible,
  getCursorPositionForVisualOffset,
  getVisualLineOffset,
  setCursorPosition,
  setSelection,
  setInlineEditSelectionAnchor,
}: UseEditorCursorSelectionParams) {
  return useCallback(() => {
    if (!bufferId || !inputRef.current) return;

    const selectionStart = inputRef.current.selectionStart;
    const selectionEnd = inputRef.current.selectionEnd;
    const focusOffset = getTextareaSelectionFocusOffset(inputRef.current);
    const anchorOffset = getTextareaSelectionAnchorOffset(inputRef.current);
    const isVisualModeActive = vimModeEnabled && vimMode === "visual";
    const position =
      isVisualModeActive && vimVisualSelection.end
        ? {
            ...vimVisualSelection.end,
            offset:
              getVisualLineOffset(vimVisualSelection.end.line) + vimVisualSelection.end.column,
          }
        : getCursorPositionForVisualOffset(focusOffset);

    if (foldTransform.hasActiveFolds) {
      const actualLine = foldTransform.mapping.virtualToActual.get(position.line) ?? position.line;
      const actualOffset = calculateActualOffset(actualLines, actualLine, position.column);
      setCursorPosition({
        line: actualLine,
        column: position.column,
        offset: actualOffset,
      });
    } else {
      setCursorPosition(position);
    }

    if (selectionStart !== selectionEnd) {
      const startPos = getCursorPositionForVisualOffset(selectionStart);
      const endPos = getCursorPositionForVisualOffset(selectionEnd);
      const anchorPos = getCursorPositionForVisualOffset(anchorOffset);
      setInlineEditSelectionAnchor({
        line: anchorPos.line,
        column: anchorPos.column,
      });

      if (foldTransform.hasActiveFolds) {
        const actualStartLine =
          foldTransform.mapping.virtualToActual.get(startPos.line) ?? startPos.line;
        const actualEndLine = foldTransform.mapping.virtualToActual.get(endPos.line) ?? endPos.line;
        setSelection({
          start: {
            line: actualStartLine,
            column: startPos.column,
            offset: calculateActualOffset(actualLines, actualStartLine, startPos.column),
          },
          end: {
            line: actualEndLine,
            column: endPos.column,
            offset: calculateActualOffset(actualLines, actualEndLine, endPos.column),
          },
        });
      } else {
        setSelection({ start: startPos, end: endPos });
      }
    } else {
      setSelection(undefined);
      if (inlineEditVisible) {
        setInlineEditSelectionAnchor({
          line: position.line,
          column: position.column,
        });
      } else {
        setInlineEditSelectionAnchor(null);
      }
    }

    const uiActions = useEditorUIStore.getState().actions;
    uiActions.setHoverInfo(null);
    uiActions.setIsHovering(false);
  }, [
    actualLines,
    bufferId,
    foldTransform,
    getCursorPositionForVisualOffset,
    getVisualLineOffset,
    inlineEditVisible,
    inputRef,
    setCursorPosition,
    setInlineEditSelectionAnchor,
    setSelection,
    vimMode,
    vimModeEnabled,
    vimVisualSelection,
  ]);
}
