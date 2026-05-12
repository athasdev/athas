import { forwardRef, memo, useEffect, useState, type RefObject } from "react";
import { EDITOR_CONSTANTS } from "../../config/constants";
import type { Position } from "../../types/editor";
import { getAccurateCursorX } from "../../utils/position";
import type { ViewPosition } from "../../view-model/view-layout";

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
      hidden = false,
    },
    ref,
  ) => {
    const [isFocused, setIsFocused] = useState(false);
    const [hasSelection, setHasSelection] = useState(false);

    useEffect(() => {
      const focusElement = textareaRef.current;
      if (!focusElement) return;

      const syncState = () => {
        setIsFocused(document.activeElement === focusElement);
        setHasSelection(
          focusElement instanceof HTMLTextAreaElement
            ? focusElement.selectionStart !== focusElement.selectionEnd
            : false,
        );
      };

      syncState();
      focusElement.addEventListener("focus", syncState);
      focusElement.addEventListener("blur", syncState);
      focusElement.addEventListener("select", syncState);
      focusElement.addEventListener("input", syncState);
      focusElement.addEventListener("keyup", syncState);
      focusElement.addEventListener("mouseup", syncState);

      return () => {
        focusElement.removeEventListener("focus", syncState);
        focusElement.removeEventListener("blur", syncState);
        focusElement.removeEventListener("select", syncState);
        focusElement.removeEventListener("input", syncState);
        focusElement.removeEventListener("keyup", syncState);
        focusElement.removeEventListener("mouseup", syncState);
      };
    }, [textareaRef]);

    if (hidden || !isFocused || hasSelection || visualLine < 0) {
      return null;
    }

    const cursorColumn = Math.min(cursorPosition.column, lineText.length);
    const left =
      cursorViewPosition?.left ??
      getAccurateCursorX(lineText, cursorColumn, fontSize, fontFamily, tabSize) +
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
    prev.hidden === next.hidden
  );
});
