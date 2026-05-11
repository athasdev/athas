/**
 * Multi-Cursor Layer - Renders secondary cursors and selections
 * The primary cursor is handled by the textarea itself
 * This layer renders additional cursors when in multi-cursor mode
 */

import { forwardRef, memo } from "react";
import { EDITOR_CONSTANTS } from "../../config/constants";
import type { Cursor } from "../../types/editor";
import { calculateSelectionBoxes } from "../../utils/selection-boxes";
import type { EditorViewLayout } from "../../view-model/view-layout";

interface MultiCursorLayerProps {
  cursors: Cursor[];
  primaryCursorId: string;
  lineHeight: number;
  lines: string[];
  lineOffsets: number[];
  contentLength: number;
  measureText: (text: string) => number;
  viewLayout?: EditorViewLayout;
}

const MultiCursorLayerComponent = forwardRef<HTMLDivElement, MultiCursorLayerProps>(
  (
    {
      cursors,
      primaryCursorId,
      lineHeight,
      lines,
      lineOffsets,
      contentLength,
      measureText,
      viewLayout,
    },
    ref,
  ) => {
    // Calculate pixel position for a cursor based on line/column
    // Adds padding offset to match textarea/highlight layer positioning
    const getCursorPosition = (line: number, column: number): { top: number; left: number } => {
      if (viewLayout) {
        const position = viewLayout.modelPositionToViewPosition(line, column);
        return { top: position.top, left: position.left };
      }

      const top = line * lineHeight + EDITOR_CONSTANTS.EDITOR_PADDING_TOP;

      const lineText = lines[line] || "";
      const textBeforeCursor = lineText.substring(0, column);

      return {
        top,
        left: measureText(textBeforeCursor) + EDITOR_CONSTANTS.EDITOR_PADDING_LEFT,
      };
    };

    // Filter out primary cursor and cursors with invalid positions (out of bounds)
    const secondaryCursors = cursors.filter((cursor) => {
      if (cursor.id === primaryCursorId) return false;
      // Bounds check: don't render if line is out of range
      if (cursor.position.line < 0 || cursor.position.line >= lines.length) return false;
      return true;
    });

    if (secondaryCursors.length === 0) return null;

    return (
      <div
        ref={ref}
        className="multi-cursor-layer pointer-events-none absolute inset-0 z-10"
        style={{ willChange: "transform" }}
      >
        {secondaryCursors.map((cursor) => {
          const { top, left } = getCursorPosition(cursor.position.line, cursor.position.column);

          // Render multi-line selections correctly with separate boxes per line
          const renderSelection = () => {
            if (!cursor.selection) return null;

            const { start, end } = cursor.selection;
            const isReversed =
              start.line > end.line || (start.line === end.line && start.column > end.column);
            const actualStart = isReversed ? end : start;
            const actualEnd = isReversed ? start : end;
            const boxes = calculateSelectionBoxes({
              selectionOffsets: {
                start: actualStart.offset,
                end: actualEnd.offset,
              },
              lines,
              lineOffsets,
              contentLength,
              lineHeight,
              measureText,
              viewLayout,
            });

            return boxes.map((box, index) => (
              <div
                key={`${cursor.id}-selection-${index}`}
                className="editor-selection-box absolute"
                style={{
                  top: `${box.top}px`,
                  left: `${box.left}px`,
                  height: `${box.height}px`,
                  width: `${box.width}px`,
                  borderTopLeftRadius: box.corners.topLeft ? undefined : 0,
                  borderTopRightRadius: box.corners.topRight ? undefined : 0,
                  borderBottomRightRadius: box.corners.bottomRight ? undefined : 0,
                  borderBottomLeftRadius: box.corners.bottomLeft ? undefined : 0,
                }}
              />
            ));
          };

          return (
            <div key={cursor.id}>
              {/* Render selection if exists */}
              {renderSelection()}

              {/* Render cursor */}
              <div
                key={`${cursor.id}:${cursor.position.line}:${cursor.position.column}:${cursor.position.offset}`}
                className="absolute w-0.5 animate-blink"
                style={{
                  top: `${top}px`,
                  left: `${left}px`,
                  height: `${lineHeight}px`,
                  backgroundColor: "var(--cursor, #d4d4d4)",
                }}
              />
            </div>
          );
        })}
      </div>
    );
  },
);

MultiCursorLayerComponent.displayName = "MultiCursorLayer";

export const MultiCursorLayer = memo(MultiCursorLayerComponent, (prev, next) => {
  return (
    prev.cursors === next.cursors &&
    prev.primaryCursorId === next.primaryCursorId &&
    prev.lineHeight === next.lineHeight &&
    prev.lines === next.lines &&
    prev.lineOffsets === next.lineOffsets &&
    prev.contentLength === next.contentLength &&
    prev.measureText === next.measureText &&
    prev.viewLayout === next.viewLayout
  );
});
