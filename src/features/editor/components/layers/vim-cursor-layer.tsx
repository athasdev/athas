/**
 * Vim Cursor Layer - Renders a block cursor for vim normal/visual modes
 * The native browser caret is hidden in these modes, so we render a custom cursor
 */

import { forwardRef, memo, useEffect, useMemo, useRef, useState } from "react";
import { EDITOR_CONSTANTS } from "../../config/constants";
import { useEditorStateStore } from "../../stores/state-store";

interface VimCursorLayerProps {
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  tabSize: number;
  content: string;
  vimMode: "normal" | "insert" | "visual" | "command";
}

const VimCursorLayerComponent = forwardRef<HTMLDivElement, VimCursorLayerProps>(
  ({ fontSize, fontFamily, lineHeight, tabSize, content, vimMode }, ref) => {
    // Read cursor position directly from store to ensure we always have latest value
    const cursorPosition = useEditorStateStore.use.cursorPosition();
    const lines = useMemo(() => content.split("\n"), [content]);
    const measureRef = useRef<HTMLSpanElement>(null);
    const [cursorStyle, setCursorStyle] = useState<{ left: number; width: number }>({
      left: EDITOR_CONSTANTS.EDITOR_PADDING_LEFT,
      width: fontSize * 0.6,
    });

    const { line, column } = cursorPosition;
    const lineText = lines[line] || "";
    const textBeforeCursor = lineText.substring(0, column);
    const charUnderCursor = lineText[column] || " ";
    const top = line * lineHeight + EDITOR_CONSTANTS.EDITOR_PADDING_TOP;

    // Determine if cursor should be visible
    const isVisible = vimMode === "normal" || vimMode === "visual";

    // Measure using DOM for accurate browser-rendered width
    // This effect must run even when cursor is hidden to keep cursorStyle updated
    useEffect(() => {
      if (!measureRef.current) return;

      // Measure text before cursor
      measureRef.current.textContent = textBeforeCursor || "";
      const leftWidth = textBeforeCursor ? measureRef.current.getBoundingClientRect().width : 0;

      // Measure character under cursor
      measureRef.current.textContent = charUnderCursor;
      const charWidth = measureRef.current.getBoundingClientRect().width || fontSize * 0.6;

      setCursorStyle({
        left: leftWidth + EDITOR_CONSTANTS.EDITOR_PADDING_LEFT,
        width: charWidth,
      });
    }, [textBeforeCursor, charUnderCursor, fontSize, fontFamily, tabSize]);

    // Always render the container with measurement span, but only show cursor when visible
    return (
      <div
        ref={ref}
        className="pointer-events-none absolute inset-0 z-10"
        style={{ willChange: "transform" }}
      >
        {/* Hidden measurement element - always rendered to ensure measurements work */}
        <span
          ref={measureRef}
          aria-hidden="true"
          style={{
            position: "absolute",
            visibility: "hidden",
            whiteSpace: "pre",
            fontSize: `${fontSize}px`,
            fontFamily,
            tabSize,
          }}
        />
        {/* Cursor - only visible in normal/visual mode */}
        {isVisible && (
          <div
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
    prev.fontSize === next.fontSize &&
    prev.fontFamily === next.fontFamily &&
    prev.lineHeight === next.lineHeight &&
    prev.tabSize === next.tabSize &&
    prev.content === next.content &&
    prev.vimMode === next.vimMode
  );
});
