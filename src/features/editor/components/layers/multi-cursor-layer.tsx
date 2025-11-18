/**
 * Multi-Cursor Layer - Renders secondary cursors and selections
 * The primary cursor is handled by the textarea itself
 * This layer renders additional cursors when in multi-cursor mode
 */

import { memo, useMemo } from "react";
import type { Cursor } from "../../types/editor";

interface MultiCursorLayerProps {
  cursors: Cursor[];
  primaryCursorId: string;
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  content: string;
}

// Padding must match textarea/highlight-layer CSS padding: 0.5rem 1rem
const EDITOR_PADDING_TOP = 8; // 0.5rem in px
const EDITOR_PADDING_LEFT = 16; // 1rem in px

const MultiCursorLayerComponent = ({
  cursors,
  primaryCursorId,
  fontSize,
  fontFamily,
  lineHeight,
  content,
}: MultiCursorLayerProps) => {
  const lines = useMemo(() => content.split("\n"), [content]);

  // Calculate pixel position for a cursor based on line/column
  // Adds padding offset to match textarea/highlight layer positioning
  const getCursorPosition = (line: number, column: number): { top: number; left: number } => {
    const top = line * lineHeight + EDITOR_PADDING_TOP;

    const lineText = lines[line] || "";
    const textBeforeCursor = lineText.substring(0, column);

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (context) {
      context.font = `${fontSize}px ${fontFamily}`;
      const width = context.measureText(textBeforeCursor).width;
      return { top, left: width + EDITOR_PADDING_LEFT };
    }

    return { top, left: column * fontSize * 0.6 + EDITOR_PADDING_LEFT };
  };

  const secondaryCursors = cursors.filter((cursor) => cursor.id !== primaryCursorId);

  if (secondaryCursors.length === 0) return null;

  return (
    <div className="multi-cursor-layer pointer-events-none absolute inset-0 z-10">
      {secondaryCursors.map((cursor) => {
        const { top, left } = getCursorPosition(cursor.position.line, cursor.position.column);

        return (
          <div key={cursor.id}>
            {/* Render selection if exists */}
            {cursor.selection && (
              <div
                className="absolute bg-selection-bg"
                style={{
                  top: `${cursor.selection.start.line * lineHeight + EDITOR_PADDING_TOP}px`,
                  left: `${getCursorPosition(cursor.selection.start.line, cursor.selection.start.column).left}px`,
                  height: `${(cursor.selection.end.line - cursor.selection.start.line + 1) * lineHeight}px`,
                  width: `${getCursorPosition(cursor.selection.end.line, cursor.selection.end.column).left - getCursorPosition(cursor.selection.start.line, cursor.selection.start.column).left}px`,
                }}
              />
            )}

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
};

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
