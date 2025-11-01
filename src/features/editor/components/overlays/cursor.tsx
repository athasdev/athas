import { useEffect, useMemo, useRef, useState } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { editorAPI } from "@/features/editor/extensions/api";
import { useEditorLayout } from "@/features/editor/hooks/use-layout";
import { useEditorSettingsStore } from "@/features/editor/stores/settings-store";
import { useEditorStateStore } from "@/features/editor/stores/state-store";
import { useEditorViewStore } from "@/features/editor/stores/view-store";
import { getAccurateCursorX } from "@/features/editor/utils/position";
import { useSettingsStore } from "@/features/settings/store";
import { useVimStore } from "@/features/vim/stores/vim-store";

export function Cursor() {
  const cursorRef = useRef<HTMLDivElement>(null);
  const movementTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { lineHeight, charWidth, gutterWidth } = useEditorLayout();
  const showLineNumbers = useEditorSettingsStore.use.lineNumbers();
  const fontSize = useEditorSettingsStore.use.fontSize();
  const fontFamily = useEditorSettingsStore.use.fontFamily();
  const tabSize = useEditorSettingsStore.use.tabSize();
  const lines = useEditorViewStore.use.lines();
  const visible = useEditorStateStore((state) => state.cursorVisible);
  const vimModeEnabled = useSettingsStore((state) => state.settings.vimMode);
  const vimMode = useVimStore.use.mode();
  const isCommandMode = useVimStore.use.isCommandMode();

  // Track viewport scroll position
  const [scrollOffset, setScrollOffset] = useState({ top: 0, left: 0 });

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

  // Listen to viewport scroll events - poll until viewport is available
  useEffect(() => {
    let rafId: number | null = null;
    let viewport: HTMLElement | null = null;
    let scrollHandler: (() => void) | null = null;
    let rafPending = false;

    const setupScrollListener = () => {
      viewport = editorAPI.getViewportRef();

      if (!viewport) {
        // Retry on next frame if viewport not available yet
        rafId = requestAnimationFrame(setupScrollListener);
        return;
      }

      scrollHandler = () => {
        if (!viewport) return;
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(() => {
          if (!viewport) return;
          setScrollOffset({
            top: viewport.scrollTop,
            left: viewport.scrollLeft,
          });
          rafPending = false;
        });
      };

      // Set initial scroll position
      scrollHandler();

      viewport.addEventListener("scroll", scrollHandler);
    };

    setupScrollListener();

    return () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      if (viewport && scrollHandler) {
        viewport.removeEventListener("scroll", scrollHandler);
      }
    };
  }, []);

  // Update position accounting for scroll offset
  useEffect(() => {
    if (!cursorRef.current || !visible) return;

    const updateCursorPosition = (position: { line: number; column: number }) => {
      if (!cursorRef.current) return;

      // Get the line content for accurate positioning
      const lineContent = lines[position.line] || "";

      // Calculate accurate X position accounting for variable-width characters
      const accurateX = getAccurateCursorX(
        lineContent,
        position.column,
        fontSize,
        fontFamily,
        tabSize,
      );

      // Position cursor at the character position, accounting for scroll offset
      const x = gutterWidth + EDITOR_CONSTANTS.GUTTER_MARGIN + accurateX - scrollOffset.left;
      const y = position.line * lineHeight - scrollOffset.top;

      // Add moving class to pause blinking
      cursorRef.current.classList.add("moving");

      // Clear existing timeout
      if (movementTimeoutRef.current) {
        clearTimeout(movementTimeoutRef.current);
      }

      // Remove moving class after cursor stops moving
      movementTimeoutRef.current = setTimeout(() => {
        cursorRef.current?.classList.remove("moving");
      }, 100);

      // Use direct positioning for immediate updates
      cursorRef.current.style.left = `${x}px`;
      cursorRef.current.style.top = `${y}px`;
    };

    const unsubscribe = useEditorStateStore.subscribe(
      (state) => state.cursorPosition,
      updateCursorPosition,
    );

    // Set initial position
    const position = useEditorStateStore.getState().cursorPosition;
    updateCursorPosition(position);

    return () => {
      unsubscribe();
      if (movementTimeoutRef.current) {
        clearTimeout(movementTimeoutRef.current);
      }
    };
  }, [
    lineHeight,
    gutterWidth,
    charWidth,
    visible,
    showLineNumbers,
    lines,
    fontSize,
    fontFamily,
    tabSize,
    scrollOffset,
  ]);

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
