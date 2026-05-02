import { forwardRef, memo, useEffect, useState, type RefObject } from "react";
import { EDITOR_CONSTANTS } from "../../config/constants";
import type { Position } from "../../types/editor";
import { getAccurateCursorX } from "../../utils/position";

interface PrimaryCursorLayerProps {
  cursorPosition: Position;
  visualLine: number;
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  tabSize: number;
  content: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  hidden?: boolean;
}

const PrimaryCursorLayerComponent = forwardRef<HTMLDivElement, PrimaryCursorLayerProps>(
  (
    {
      cursorPosition,
      visualLine,
      fontSize,
      fontFamily,
      lineHeight,
      tabSize,
      content,
      textareaRef,
      hidden = false,
    },
    ref,
  ) => {
    const [isFocused, setIsFocused] = useState(false);
    const [hasSelection, setHasSelection] = useState(false);

    useEffect(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const syncState = () => {
        setIsFocused(document.activeElement === textarea);
        setHasSelection(textarea.selectionStart !== textarea.selectionEnd);
      };

      syncState();
      textarea.addEventListener("focus", syncState);
      textarea.addEventListener("blur", syncState);
      textarea.addEventListener("select", syncState);
      textarea.addEventListener("input", syncState);
      textarea.addEventListener("keyup", syncState);
      textarea.addEventListener("mouseup", syncState);

      return () => {
        textarea.removeEventListener("focus", syncState);
        textarea.removeEventListener("blur", syncState);
        textarea.removeEventListener("select", syncState);
        textarea.removeEventListener("input", syncState);
        textarea.removeEventListener("keyup", syncState);
        textarea.removeEventListener("mouseup", syncState);
      };
    }, [textareaRef]);

    if (hidden || !isFocused || hasSelection || visualLine < 0) {
      return null;
    }

    const lines = content.split("\n");
    const lineText = lines[visualLine] || "";
    const cursorColumn = Math.min(cursorPosition.column, lineText.length);
    const left =
      getAccurateCursorX(lineText, cursorColumn, fontSize, fontFamily, tabSize) +
      EDITOR_CONSTANTS.EDITOR_PADDING_LEFT;
    const top = visualLine * lineHeight + EDITOR_CONSTANTS.EDITOR_PADDING_TOP;

    return (
      <div ref={ref} className="pointer-events-none absolute inset-0 z-10">
        <div
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
    prev.fontSize === next.fontSize &&
    prev.fontFamily === next.fontFamily &&
    prev.lineHeight === next.lineHeight &&
    prev.tabSize === next.tabSize &&
    prev.content === next.content &&
    prev.textareaRef === next.textareaRef &&
    prev.hidden === next.hidden
  );
});
