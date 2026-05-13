import { useCallback, useRef, type MouseEvent, type RefObject } from "react";
import { parseDiffAccordionLine } from "@/features/git/utils/diff-editor-content";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import type { InlayHint } from "@/features/editor/lsp/use-inlay-hints";
import type { FoldTransformResult } from "./use-fold-transform";
import type { MultiCursorState, Position, Range } from "@/features/editor/types/editor";
import { calculateActualOffset } from "@/features/athas-editor/utils/fold-transformer";
import {
  buildSelectionFromAnchor,
  getSelectionAnchorForCursor,
  getTextareaSelectionFocusOffset,
} from "@/features/athas-editor/utils/selection-ranges";
import type { EditorViewLayout } from "@/features/athas-editor/view-model/view-layout";

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
  selection?: Range;
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
  selection,
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
  const selectionDragAnchorRef = useRef<{ actual: Position; virtualOffset: number } | null>(null);

  const getVirtualOffsetForPosition = useCallback(
    (position: Position): number => {
      const visualLine = foldTransform.hasActiveFolds
        ? (foldTransform.mapping.actualToVirtual.get(position.line) ?? position.line)
        : position.line;

      return Math.min(getVisualLineOffset(visualLine) + position.column, displayContentLength);
    },
    [displayContentLength, foldTransform, getVisualLineOffset],
  );

  const resolvePositionFromClientPoint = useCallback(
    (clientX: number, clientY: number) => {
      const textarea = inputRef.current;
      if (!textarea) return null;

      const rect = textarea.getBoundingClientRect();
      const editorX = clientX - rect.left + textarea.scrollLeft;
      const editorY = clientY - rect.top + textarea.scrollTop;
      const position = viewLayout.editorPointToModelPosition(editorX, editorY);
      const visualLine = Math.max(0, Math.min(Math.max(lines.length - 1, 0), position.modelLine));
      const lineText = lines[visualLine] || "";
      const lineHints = visualInlayHints.filter((hint) => hint.line === visualLine);
      const localX = Math.max(0, editorX - EDITOR_CONSTANTS.EDITOR_PADDING_LEFT);
      const column =
        lineHints.length > 0
          ? getColumnForInlayAdjustedX(lineText, lineHints, localX)
          : Math.max(0, Math.min(position.column, lineText.length));
      const virtualOffset = Math.min(
        getVisualLineOffset(visualLine) + column,
        displayContentLength,
      );
      const virtualPosition: Position = {
        line: visualLine,
        column,
        offset: virtualOffset,
      };

      if (!foldTransform.hasActiveFolds) {
        return {
          actual: virtualPosition,
          virtualOffset,
        };
      }

      const actualLine = foldTransform.mapping.virtualToActual.get(visualLine) ?? visualLine;
      return {
        actual: {
          line: actualLine,
          column,
          offset: calculateActualOffset(actualLines, actualLine, column),
        },
        virtualOffset,
      };
    },
    [
      actualLines,
      displayContentLength,
      foldTransform,
      getColumnForInlayAdjustedX,
      getVisualLineOffset,
      inputRef,
      lines,
      viewLayout,
      visualInlayHints,
    ],
  );

  const applyResolvedSelection = useCallback(
    (
      textarea: HTMLTextAreaElement,
      anchor: { actual: Position; virtualOffset: number },
      focus: { actual: Position; virtualOffset: number },
    ) => {
      const selectionStart = Math.min(anchor.virtualOffset, focus.virtualOffset);
      const selectionEnd = Math.max(anchor.virtualOffset, focus.virtualOffset);
      const direction = anchor.virtualOffset > focus.virtualOffset ? "backward" : "forward";

      textarea.setSelectionRange(selectionStart, selectionEnd, direction);
      textarea.dispatchEvent(new Event("select", { bubbles: true }));
      setCursorPosition(focus.actual);
      setSelection(buildSelectionFromAnchor(anchor.actual, focus.actual));
    },
    [setCursorPosition, setSelection],
  );

  const handleMouseDown = useCallback(
    (event: MouseEvent<HTMLTextAreaElement>) => {
      if (!useGlobalEditorState || readOnly || event.button !== 0) return;
      if (event.altKey || event.metaKey || event.ctrlKey || event.detail > 1) {
        return;
      }

      const textarea = inputRef.current;
      if (!textarea) return;
      const focus = resolvePositionFromClientPoint(event.clientX, event.clientY);
      if (!focus) return;

      event.preventDefault();
      window.getSelection()?.removeAllRanges();
      textarea.focus();

      const anchorPosition = event.shiftKey
        ? getSelectionAnchorForCursor(selection, cursorPosition)
        : focus.actual;
      const selectionAnchor = {
        actual: anchorPosition,
        virtualOffset: event.shiftKey
          ? getVirtualOffsetForPosition(anchorPosition)
          : focus.virtualOffset,
      };

      selectionDragAnchorRef.current = selectionAnchor;
      applyResolvedSelection(textarea, selectionAnchor, focus);

      const handleDocumentMouseMove = (moveEvent: globalThis.MouseEvent) => {
        if (!selectionDragAnchorRef.current || (moveEvent.buttons & 1) !== 1) return;

        const nextFocus = resolvePositionFromClientPoint(moveEvent.clientX, moveEvent.clientY);
        if (!nextFocus) return;

        moveEvent.preventDefault();
        applyResolvedSelection(textarea, selectionDragAnchorRef.current, nextFocus);
      };

      const handleDocumentMouseUp = () => {
        selectionDragAnchorRef.current = null;
        window.removeEventListener("mousemove", handleDocumentMouseMove, true);
        window.removeEventListener("mouseup", handleDocumentMouseUp, true);
      };

      window.addEventListener("mousemove", handleDocumentMouseMove, true);
      window.addEventListener("mouseup", handleDocumentMouseUp, true);
    },
    [
      applyResolvedSelection,
      cursorPosition,
      getVirtualOffsetForPosition,
      inputRef,
      readOnly,
      resolvePositionFromClientPoint,
      selection,
      useGlobalEditorState,
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
