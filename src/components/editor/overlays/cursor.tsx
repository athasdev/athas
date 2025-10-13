import { useEffect, useMemo, useRef } from "react";
import { EDITOR_CONSTANTS } from "@/constants/editor-constants";
import { useEditorLayout } from "@/hooks/use-editor-layout";
import { useSettingsStore } from "@/settings/store";
import { useEditorCursorStore } from "@/stores/editor-cursor-store";
import { useEditorSettingsStore } from "@/stores/editor-settings-store";
import { useVimStore } from "@/stores/vim-store";

export function Cursor() {
  const cursorRef = useRef<HTMLDivElement>(null);
  const movementTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { lineHeight, charWidth, gutterWidth } = useEditorLayout();
  const showLineNumbers = useEditorSettingsStore.use.lineNumbers();
  const visible = useEditorCursorStore((state) => state.cursorVisible);
  const vimModeEnabled = useSettingsStore((state) => state.settings.vimMode);
  const vimMode = useVimStore.use.mode();
  const isCommandMode = useVimStore.use.isCommandMode();

  const cursorStyle = useMemo(() => {
    const isBlockCursor = vimModeEnabled && !isCommandMode && vimMode === "normal";
    const width = Math.max(2, charWidth);

    return {
      width: isBlockCursor ? `${width}px` : "2px",
      backgroundColor: isBlockCursor
        ? "var(--cursor-color-block, rgba(59, 130, 246, 0.65))"
        : "var(--cursor-color, var(--color-cursor))",
      borderRadius: isBlockCursor ? "2px" : "1px",
      opacity: isBlockCursor ? 0.85 : 1,
    };
  }, [vimModeEnabled, vimMode, isCommandMode, charWidth]);

  // Update position without re-rendering - cursor scrolls naturally with content
  useEffect(() => {
    if (!cursorRef.current || !visible) return;

    const unsubscribe = useEditorCursorStore.subscribe(
      (state) => state.cursorPosition,
      (position) => {
        if (!cursorRef.current) return;

        // Position cursor at the character position (no scroll offset needed - browser handles it)
        const x = gutterWidth + EDITOR_CONSTANTS.GUTTER_MARGIN + position.column * charWidth;
        const y = position.line * lineHeight;

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
      },
    );

    // Set initial position
    const position = useEditorCursorStore.getState().cursorPosition;
    const x = gutterWidth + EDITOR_CONSTANTS.GUTTER_MARGIN + position.column * charWidth;
    const y = position.line * lineHeight;
    cursorRef.current.style.left = `${x}px`;
    cursorRef.current.style.top = `${y}px`;

    return () => {
      unsubscribe();
      if (movementTimeoutRef.current) {
        clearTimeout(movementTimeoutRef.current);
      }
    };
  }, [lineHeight, gutterWidth, charWidth, visible, showLineNumbers]);

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
