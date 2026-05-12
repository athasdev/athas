import { useCallback, type MouseEvent, type RefObject } from "react";
import { parseDiffAccordionLine } from "@/features/git/utils/diff-editor-content";
import { EDITOR_CONSTANTS } from "../config/constants";
import type { InlayHint } from "../lsp/use-inlay-hints";
import type { FoldTransformResult } from "./use-fold-transform";
import type { MultiCursorState, Position, Range } from "../types/editor";
import { calculateActualOffset } from "../utils/fold-transformer";
import { getTextareaSelectionFocusOffset } from "../utils/selection-ranges";
import type { EditorViewLayout } from "../view-model/view-layout";

interface UseEditorMouseInteractionsParams {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  bufferId: string | null;
  filePath?: string;
  readOnly: boolean;
  useGlobalEditorState: boolean;
  visualInlayHints: InlayHint[];
  viewLayout: EditorViewLayout;
  lines: string[];
  actualLines: string[];
  displayContentLength: number;
  foldTransform: FoldTransformResult;
  multiCursorState: MultiCursorState | null;
  cursorPosition: Position;
  getVisualLineOffset: (lineIndex: number) => number;
  getCursorPositionForVisualOffset: (offset: number) => Position;
  getColumnForInlayAdjustedX: (lineText: string, lineHints: InlayHint[], x: number) => number;
  setCursorPosition: (position: Position) => void;
  setSelection: (selection?: Range) => void;
  enableMultiCursor: () => void;
  addCursor: (position: Position, selection?: Range) => void;
  clearSecondaryCursors: () => void;
  toggleFold: (filePath: string, line: number) => void;
  onReadonlySurfaceClick?: (position: { line: number; column: number }) => void;
}

export function useEditorMouseInteractions({
  inputRef,
  bufferId,
  filePath,
  readOnly,
  useGlobalEditorState,
  visualInlayHints,
  viewLayout,
  lines,
  actualLines,
  displayContentLength,
  foldTransform,
  multiCursorState,
  cursorPosition,
  getVisualLineOffset,
  getCursorPositionForVisualOffset,
  getColumnForInlayAdjustedX,
  setCursorPosition,
  setSelection,
  enableMultiCursor,
  addCursor,
  clearSecondaryCursors,
  toggleFold,
  onReadonlySurfaceClick,
}: UseEditorMouseInteractionsParams) {
  const handleMouseDown = useCallback(
    (event: MouseEvent<HTMLTextAreaElement>) => {
      if (!useGlobalEditorState || readOnly || event.button !== 0) return;
      if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey || event.detail > 1) {
        return;
      }

      const textarea = inputRef.current;
      if (!textarea) return;
      if (visualInlayHints.length === 0 && viewLayout.totalZoneHeight === 0) return;

      const rect = textarea.getBoundingClientRect();
      const editorX = event.clientX - rect.left + textarea.scrollLeft;
      const editorY = event.clientY - rect.top + textarea.scrollTop;
      const position = viewLayout.editorPointToModelPosition(editorX, editorY);
      const visualLine = Math.max(0, Math.min(lines.length - 1, position.modelLine));
      const lineHints = visualInlayHints.filter((hint) => hint.line === visualLine);

      event.preventDefault();

      const lineText = lines[visualLine] || "";
      const localX = Math.max(0, editorX - EDITOR_CONSTANTS.EDITOR_PADDING_LEFT);
      const column =
        lineHints.length > 0
          ? getColumnForInlayAdjustedX(lineText, lineHints, localX)
          : position.column;
      const virtualOffset = Math.min(
        getVisualLineOffset(visualLine) + column,
        displayContentLength,
      );

      textarea.focus();
      textarea.selectionStart = virtualOffset;
      textarea.selectionEnd = virtualOffset;

      if (foldTransform.hasActiveFolds) {
        const actualLine = foldTransform.mapping.virtualToActual.get(visualLine) ?? visualLine;
        const actualOffset = calculateActualOffset(actualLines, actualLine, column);
        setCursorPosition({
          line: actualLine,
          column,
          offset: actualOffset,
        });
      } else {
        setCursorPosition({
          line: visualLine,
          column,
          offset: virtualOffset,
        });
      }

      setSelection(undefined);
    },
    [
      actualLines,
      displayContentLength,
      foldTransform,
      getColumnForInlayAdjustedX,
      getVisualLineOffset,
      inputRef,
      lines,
      readOnly,
      setCursorPosition,
      setSelection,
      useGlobalEditorState,
      viewLayout,
      visualInlayHints,
    ],
  );

  const handleClick = useCallback(
    (event: MouseEvent<HTMLTextAreaElement>) => {
      if (!bufferId || !inputRef.current) return;

      if (event.altKey) {
        event.preventDefault();

        const selectionStart = inputRef.current.selectionStart;
        const selectionEnd = inputRef.current.selectionEnd;
        const focusOffset = getTextareaSelectionFocusOffset(inputRef.current);

        const clickedPosition = getCursorPositionForVisualOffset(focusOffset);

        const clickSelection =
          selectionStart !== selectionEnd
            ? {
                start: getCursorPositionForVisualOffset(selectionStart),
                end: getCursorPositionForVisualOffset(selectionEnd),
              }
            : undefined;

        if (!multiCursorState) {
          enableMultiCursor();
          const isDifferentPosition =
            clickedPosition.line !== cursorPosition.line ||
            clickedPosition.column !== cursorPosition.column;
          if (isDifferentPosition) {
            addCursor(clickedPosition, clickSelection);
          }
        } else {
          addCursor(clickedPosition, clickSelection);
        }
        return;
      }

      if (multiCursorState && multiCursorState.cursors.length > 1) {
        clearSecondaryCursors();
      }

      const focusOffset = getTextareaSelectionFocusOffset(inputRef.current);
      const clickedPosition = getCursorPositionForVisualOffset(focusOffset);
      const clickedLine = lines[clickedPosition.line] || "";
      const accordionMeta = parseDiffAccordionLine(clickedLine);

      if (accordionMeta && filePath) {
        const actualLine = foldTransform.hasActiveFolds
          ? (foldTransform.mapping.virtualToActual.get(clickedPosition.line) ??
            clickedPosition.line)
          : clickedPosition.line;
        toggleFold(filePath, actualLine);
        inputRef.current.blur();
        return;
      }

      if (filePath && foldTransform.foldMarkers.has(clickedPosition.line)) {
        const actualLine =
          foldTransform.mapping.virtualToActual.get(clickedPosition.line) ?? clickedPosition.line;
        toggleFold(filePath, actualLine);
        inputRef.current.blur();
        return;
      }

      if ((readOnly || (!useGlobalEditorState && event.detail >= 2)) && onReadonlySurfaceClick) {
        onReadonlySurfaceClick({
          line: clickedPosition.line,
          column: clickedPosition.column,
        });
      }
    },
    [
      addCursor,
      bufferId,
      clearSecondaryCursors,
      cursorPosition,
      enableMultiCursor,
      filePath,
      foldTransform,
      getCursorPositionForVisualOffset,
      inputRef,
      lines,
      multiCursorState,
      onReadonlySurfaceClick,
      readOnly,
      toggleFold,
      useGlobalEditorState,
    ],
  );

  return { handleMouseDown, handleClick };
}
