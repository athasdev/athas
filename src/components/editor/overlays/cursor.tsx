import { useCallback, useEffect, useMemo, useRef } from "react";
import { EDITOR_CONSTANTS } from "@/constants/editor-constants";
import { useEditorLayout } from "@/hooks/use-editor-layout";
import { useSettingsStore } from "@/settings/store";
import { useEditorCursorStore } from "@/stores/editor-cursor-store";
import { useVimStore } from "@/stores/vim-store";
import type { Position } from "@/types/editor-types";

export function Cursor() {
  const cursorRef = useRef<HTMLDivElement>(null);
  const movementTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const scrollTopRef = useRef(0);
  const scrollLeftRef = useRef(0);
  const { lineHeight, charWidth, gutterWidth } = useEditorLayout();
  const visible = useEditorCursorStore((state) => state.cursorVisible);
  const vimModeEnabled = useSettingsStore((state) => state.settings.vimMode);
  const vimMode = useVimStore.use.mode();
  const isCommandMode = useVimStore.use.isCommandMode();

  const cursorStyle = useMemo(() => {
    const isNormalMode = vimModeEnabled && vimMode === "normal";
    const isInsertMode = vimModeEnabled && vimMode === "insert";
    const width = Math.max(2, charWidth);

    return {
      width: isNormalMode ? `${width}px` : "2px",
      backgroundColor: isNormalMode
        ? "var(--color-cursor-vim-normal)"
        : isInsertMode
          ? "var(--color-cursor-vim-insert)"
          : "var(--color-cursor)",
      borderRadius: isNormalMode ? "2px" : "1px",
      opacity: isNormalMode ? 0.85 : 1,
    };
  }, [vimModeEnabled, vimMode, isCommandMode, charWidth]);

  const updateCursorPosition = useCallback(
    (position: Position) => {
      if (!cursorRef.current) return;

      const x =
        gutterWidth +
        EDITOR_CONSTANTS.GUTTER_MARGIN +
        position.column * charWidth -
        scrollLeftRef.current;
      const y = position.line * lineHeight - scrollTopRef.current;

      cursorRef.current.style.left = `${x}px`;
      cursorRef.current.style.top = `${y}px`;
    },
    [charWidth, gutterWidth, lineHeight],
  );

  // Update position without re-rendering - adjust for scroll offsets
  useEffect(() => {
    if (!cursorRef.current || !visible) return;

    const unsubscribe = useEditorCursorStore.subscribe(
      (state) => state.cursorPosition,
      (position) => {
        if (!cursorRef.current) return;

        cursorRef.current.classList.add("moving");

        if (movementTimeoutRef.current) {
          clearTimeout(movementTimeoutRef.current);
        }

        movementTimeoutRef.current = setTimeout(() => {
          cursorRef.current?.classList.remove("moving");
        }, 100);

        updateCursorPosition(position);
      },
    );

    // Set initial position
    updateCursorPosition(useEditorCursorStore.getState().cursorPosition);

    return () => {
      unsubscribe();
      if (movementTimeoutRef.current) {
        clearTimeout(movementTimeoutRef.current);
      }
    };
  }, [updateCursorPosition, visible]);

  // Track viewport scroll to offset cursor position
  useEffect(() => {
    const viewport = document.querySelector(".editor-viewport") as HTMLDivElement | null;
    if (!viewport) return;

    const handleScroll = () => {
      scrollTopRef.current = viewport.scrollTop;
      scrollLeftRef.current = viewport.scrollLeft;
      updateCursorPosition(useEditorCursorStore.getState().cursorPosition);
    };

    handleScroll();
    viewport.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      viewport.removeEventListener("scroll", handleScroll);
    };
  }, [updateCursorPosition]);

  if (!visible) return null;

  return (
    <div
      ref={cursorRef}
      className="editor-cursor"
      style={{
        position: "absolute",
        height: `${lineHeight}px`,
        ...cursorStyle,
        pointerEvents: "none",
      }}
    />
  );
}
