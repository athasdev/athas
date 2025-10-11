import { useEffect, useRef } from "react";
import { EDITOR_CONSTANTS } from "@/constants/editor-constants";
import { useEditorLayout } from "@/hooks/use-editor-layout";
import { useEditorCursorStore } from "@/stores/editor-cursor-store";
import { useEditorSettingsStore } from "@/stores/editor-settings-store";

export function Cursor() {
  const cursorRef = useRef<HTMLDivElement>(null);
  const movementTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { lineHeight, charWidth, gutterWidth } = useEditorLayout();
  const showLineNumbers = useEditorSettingsStore.use.lineNumbers();
  const visible = useEditorCursorStore((state) => state.cursorVisible);

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
        width: "2px",
        height: `${lineHeight}px`,
        backgroundColor: "var(--cursor-color, var(--color-cursor))",
        pointerEvents: "none",
      }}
    />
  );
}
