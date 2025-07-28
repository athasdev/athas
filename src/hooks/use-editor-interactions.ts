import { useCallback, useRef } from "react";
import { useEditorViewStore } from "../stores/editor-view-store";
import type { Position } from "../types/editor-types";

interface UseEditorInteractionsProps {
  lineHeight: number;
  fontSize: number;
  gutterWidth: number;
  onPositionClick?: (position: Position) => void;
  onSelectionDrag?: (start: Position, end: Position) => void;
}

export const useEditorInteractions = ({
  lineHeight,
  fontSize,
  gutterWidth,
  onPositionClick,
  onSelectionDrag,
}: UseEditorInteractionsProps) => {
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<Position | null>(null);
  const GUTTER_MARGIN = 8; // mr-2 in Tailwind (0.5rem = 8px)

  const getPositionFromCoordinates = useCallback(
    (clientX: number, clientY: number, containerRect: DOMRect): Position | null => {
      // console.log("firing getPositionFromCoordinates")
      // Calculate relative position
      const relativeX = clientX - containerRect.left - gutterWidth - GUTTER_MARGIN;
      const relativeY = clientY - containerRect.top;

      // Calculate line number
      const line = Math.floor(relativeY / lineHeight);
      const currentLines = useEditorViewStore.getState().lines;
      if (line < 0 || line >= currentLines.length) {
        return null;
      }

      // Get line content
      const lineContent = currentLines[line];
      if (lineContent === undefined || lineContent === null) {
        return null;
      }

      // Calculate column using fixed character width for monospace font
      const charWidth = fontSize * 0.6;
      const column = Math.round(relativeX / charWidth);

      // Clamp column to line bounds (handles empty lines where length is 0)
      const clampedColumn = Math.max(0, Math.min(column, lineContent.length));

      // Calculate offset
      let offset = 0;
      for (let i = 0; i < line; i++) {
        offset += currentLines[i].length + 1; // +1 for newline
      }
      offset += clampedColumn;

      return { line, column: clampedColumn, offset };
    },
    [lineHeight, fontSize, gutterWidth],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      const container = e.currentTarget;
      const rect = container.getBoundingClientRect();
      const position = getPositionFromCoordinates(e.clientX, e.clientY, rect);

      if (position && onPositionClick) {
        onPositionClick(position);
      }
    },
    [getPositionFromCoordinates, onPositionClick],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      const container = e.currentTarget;
      const rect = container.getBoundingClientRect();
      const position = getPositionFromCoordinates(e.clientX, e.clientY, rect);

      if (position) {
        isDraggingRef.current = true;
        dragStartRef.current = position;

        // Prevent default text selection
        e.preventDefault();
      }
    },
    [getPositionFromCoordinates],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      if (!isDraggingRef.current || !dragStartRef.current) {
        return;
      }

      const container = e.currentTarget;
      const rect = container.getBoundingClientRect();
      const position = getPositionFromCoordinates(e.clientX, e.clientY, rect);

      if (position && onSelectionDrag) {
        onSelectionDrag(dragStartRef.current, position);
      }
    },
    [getPositionFromCoordinates, onSelectionDrag],
  );

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false;
    dragStartRef.current = null;
  }, []);

  return {
    handleClick,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    getPositionFromCoordinates,
  };
};
