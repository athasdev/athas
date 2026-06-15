import { forwardRef, memo, useEffect, useState, type RefObject } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import type { Position } from "@/features/editor/types/editor.types";
import { measureRenderedTextWidth } from "@/features/athas-editor/utils/position";
import type { ViewPosition } from "@/features/athas-editor/view-model/view-layout";

interface PrimaryCursorLayerProps {
  cursorPosition: Position;
  visualLine: number;
  cursorViewPosition?: ViewPosition;
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  tabSize: number;
  lineText: string;
  textareaRef: RefObject<HTMLElement | null>;
  hasSelection?: boolean;
  hidden?: boolean;
}

const PrimaryCursorLayerComponent = forwardRef<HTMLDivElement, PrimaryCursorLayerProps>(
  (
    {
      cursorPosition,
      visualLine,
      cursorViewPosition,
      fontSize,
      fontFamily,
      lineHeight,
      tabSize,
      lineText,
      textareaRef,
      hasSelection = false,
      hidden = false,
    },
    ref,
  ) => {
    const [isFocused, setIsFocused] = useState(false);

    useEffect(() => {
      const focusElement = textareaRef.current;
      if (!focusElement) return;

      const syncState = () => {
        setIsFocused(document.activeElement === focusElement);
      };

      syncState();
      focusElement.addEventListener("focus", syncState);
      focusElement.addEventListener("blur", syncState);

      return () => {
        focusElement.removeEventListener("focus", syncState);
        focusElement.removeEventListener("blur", syncState);
      };
    }, [textareaRef]);

    if (hidden || !isFocused || hasSelection || visualLine < 0) {
      return null;
    }

    const segmentStartColumn = cursorViewPosition?.segment.startColumn ?? 0;
    const cursorColumn = Math.max(
      segmentStartColumn,
      Math.min(cursorPosition.column, lineText.length),
    );
    const textBeforeCursor = lineText.slice(segmentStartColumn, cursorColumn);
    const left =
      measureRenderedTextWidth(textBeforeCursor, fontSize, fontFamily, tabSize) +
      EDITOR_CONSTANTS.EDITOR_PADDING_LEFT;
    const top =
      cursorViewPosition?.top ?? visualLine * lineHeight + EDITOR_CONSTANTS.EDITOR_PADDING_TOP;
    const cursorKey = `${cursorPosition.line}:${cursorPosition.column}:${cursorPosition.offset}`;

    return (
      <div ref={ref} className="pointer-events-none absolute inset-0 z-10">
        <div
          key={cursorKey}
          data-editor-primary-cursor
          className="absolute animate-blink"
          style={{
            top: `${top}px`,
            left: `${left}px`,
            width: "2px",
            height: `${lineHeight}px`,
            backgroundColor: "var(--text, #d4d4d4)",
          }}
        />
      </div>
    );
  },
);

PrimaryCursorLayerComponent.displayName = "PrimaryCursorLayer";

export const PrimaryCursorLayer = memo(PrimaryCursorLayerComponent, (prev, next) => {
  return (
    prev.cursorPosition === next.cursorPosition &&
    prev.visualLine === next.visualLine &&
    prev.cursorViewPosition === next.cursorViewPosition &&
    prev.fontSize === next.fontSize &&
    prev.fontFamily === next.fontFamily &&
    prev.lineHeight === next.lineHeight &&
    prev.tabSize === next.tabSize &&
    prev.lineText === next.lineText &&
    prev.textareaRef === next.textareaRef &&
    prev.hasSelection === next.hasSelection &&
    prev.hidden === next.hidden
  );
});
