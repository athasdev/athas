/**
 * Multi-Cursor Layer - Renders secondary cursors and selections
 * The primary cursor is handled by the textarea itself
 * This layer renders additional cursors when in multi-cursor mode
 */

import type React from "react";
import { forwardRef, memo, useMemo } from "react";
import { EDITOR_CONSTANTS } from "../../config/constants";
import type { Cursor } from "../../types/editor";

interface MultiCursorLayerProps {
  cursors: Cursor[];
  primaryCursorId: string;
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  content: string;
}

const MultiCursorLayerComponent = forwardRef<HTMLDivElement, MultiCursorLayerProps>(
  ({ cursors, primaryCursorId, fontSize, fontFamily, lineHeight, content }, ref) => {
    const lines = useMemo(() => content.split("\n"), [content]);

    // Calculate pixel position for a cursor based on line/column
    // Adds padding offset to match textarea/highlight layer positioning
    const getCursorPosition = (line: number, column: number): { top: number; left: number } => {
      const top = line * lineHeight + EDITOR_CONSTANTS.EDITOR_PADDING_TOP;

      const lineText = lines[line] || "";
      const textBeforeCursor = lineText.substring(0, column);

      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (context) {
        context.font = `${fontSize}px ${fontFamily}`;
        const width = context.measureText(textBeforeCursor).width;
        return { top, left: width + EDITOR_CONSTANTS.EDITOR_PADDING_LEFT };
      }

      return { top, left: column * fontSize * 0.6 + EDITOR_CONSTANTS.EDITOR_PADDING_LEFT };
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
            const startLine = Math.min(start.line, end.line);
            const endLine = Math.max(start.line, end.line);
            const isReversed =
              start.line > end.line || (start.line === end.line && start.column > end.column);
            const actualStart = isReversed ? end : start;
            const actualEnd = isReversed ? start : end;

            const boxes: React.ReactNode[] = [];

            for (let line = startLine; line <= endLine; line++) {
              const lineText = lines[line] || "";
              let startCol: number;
              let endCol: number;

              if (startLine === endLine) {
                // Single line selection
                startCol = Math.min(actualStart.column, actualEnd.column);
                endCol = Math.max(actualStart.column, actualEnd.column);
              } else if (line === startLine) {
                // First line: from start column to end of line
                startCol = actualStart.column;
                endCol = lineText.length;
              } else if (line === endLine) {
                // Last line: from beginning to end column
                startCol = 0;
                endCol = actualEnd.column;
              } else {
                // Middle lines: entire line
                startCol = 0;
                endCol = lineText.length;
              }

              const leftPos = getCursorPosition(line, startCol).left;
              const rightPos = getCursorPosition(line, endCol).left;

              boxes.push(
                <div
                  key={`${cursor.id}-selection-${line}`}
                  className="absolute bg-selection-bg"
                  style={{
                    top: `${line * lineHeight + EDITOR_CONSTANTS.EDITOR_PADDING_TOP}px`,
                    left: `${leftPos}px`,
                    height: `${lineHeight}px`,
                    width: `${Math.max(rightPos - leftPos, 2)}px`,
                  }}
                />,
              );
            }

            return boxes;
          };

          return (
            <div key={cursor.id}>
              {/* Render selection if exists */}
              {renderSelection()}

              {/* Render cursor */}
              <div
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
    prev.fontSize === next.fontSize &&
    prev.fontFamily === next.fontFamily &&
    prev.lineHeight === next.lineHeight &&
    prev.content === next.content
  );
});
