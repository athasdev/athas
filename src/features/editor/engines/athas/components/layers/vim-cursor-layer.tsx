/**
 * Vim Cursor Layer - Renders a block cursor for vim normal/visual modes
 * The native browser caret is hidden in these modes, so we render a custom cursor
 */

import { forwardRef, memo } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import type { Position } from "@/features/editor/types/editor.types";
import { measureTextWidth } from "@/features/editor/utils/position";
import type { ViewPosition } from "@/features/editor/view-model/view-layout";

interface VimCursorLayerProps {
  visualLine: number;
  cursorViewPosition?: ViewPosition;
  cursorPosition: Position;
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  tabSize: number;
  lineText: string;
  vimMode: "normal" | "insert" | "visual" | "command";
}

const VimCursorLayerComponent = forwardRef<HTMLDivElement, VimCursorLayerProps>(
  (
    {
      visualLine,
      cursorViewPosition,
      cursorPosition,
      fontSize,
      fontFamily,
      lineHeight,
      tabSize,
      lineText,
      vimMode,
    },
    ref,
  ) => {
    const { column } = cursorPosition;
    const textBeforeCursor = lineText.substring(0, column);
    const charUnderCursor = lineText[column] || " ";
    const leftWidth = textBeforeCursor
      ? measureTextWidth(textBeforeCursor, fontSize, fontFamily, tabSize)
      : 0;
    const charWidth =
      measureTextWidth(charUnderCursor, fontSize, fontFamily, tabSize) || fontSize * 0.6;
    const cursorStyle = {
      left: cursorViewPosition?.left ?? leftWidth + EDITOR_CONSTANTS.EDITOR_PADDING_LEFT,
      width: charWidth,
    };
    const top =
      cursorViewPosition?.top ?? visualLine * lineHeight + EDITOR_CONSTANTS.EDITOR_PADDING_TOP;
    const cursorKey = `${cursorPosition.line}:${cursorPosition.column}:${cursorPosition.offset}`;

    // Determine if cursor should be visible
    const isVisible = vimMode === "normal" || vimMode === "visual";

    return (
      <div
        ref={ref}
        className="pointer-events-none absolute inset-0 z-10"
        style={{ willChange: "transform" }}
      >
        {isVisible && (
          <div
            key={cursorKey}
            className="absolute animate-blink"
            style={{
              top: `${top}px`,
              left: `${cursorStyle.left}px`,
              width: `${cursorStyle.width}px`,
              height: `${lineHeight}px`,
              backgroundColor: "var(--color-cursor-vim-normal)",
            }}
          />
        )}
      </div>
    );
  },
);

VimCursorLayerComponent.displayName = "VimCursorLayer";

export const VimCursorLayer = memo(VimCursorLayerComponent, (prev, next) => {
  return (
    prev.visualLine === next.visualLine &&
    prev.cursorViewPosition === next.cursorViewPosition &&
    prev.cursorPosition === next.cursorPosition &&
    prev.fontSize === next.fontSize &&
    prev.fontFamily === next.fontFamily &&
    prev.lineHeight === next.lineHeight &&
    prev.tabSize === next.tabSize &&
    prev.lineText === next.lineText &&
    prev.vimMode === next.vimMode
  );
});
