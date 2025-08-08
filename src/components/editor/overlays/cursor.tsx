import { useEffect, useRef } from "react";
import { useEditorLayout } from "@/hooks/use-editor-layout";
import { useEditorCursorStore } from "@/stores/editor-cursor-store";
import { useEditorLayoutStore } from "@/stores/editor-layout-store";
import { useEditorSettingsStore } from "@/stores/editor-settings-store";

interface CursorRendererProps {
  visible?: boolean;
}

export function Cursor({ visible = true }: CursorRendererProps) {
  const cursorRef = useRef<HTMLDivElement>(null);
  const movementTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { scrollTop, scrollLeft } = useEditorLayoutStore();
  const { lineHeight, charWidth, gutterWidth } = useEditorLayout();
  const showLineNumbers = useEditorSettingsStore.use.lineNumbers();

  // Update position without re-rendering
  useEffect(() => {
    if (!cursorRef.current || !visible) return;

    const unsubscribe = useEditorCursorStore.subscribe(
      (state) => state.cursorPosition,
      (position) => {
        if (!cursorRef.current) return;

        // Position cursor relative to the text content area
        // Account for gutter width and conditional padding
        const contentPadding = showLineNumbers ? 0 : 16;
        // Position cursor after the character
        const x = gutterWidth + contentPadding + (position.column + 1) * charWidth - scrollLeft;
        const y = position.line * lineHeight - scrollTop;

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
    // Position cursor relative to the text content area
    const contentPadding = showLineNumbers ? 0 : 16; // 16px padding when no line numbers
    // Position cursor after the character
    const x = gutterWidth + contentPadding + (position.column + 1) * charWidth - scrollLeft;
    const y = position.line * lineHeight - scrollTop;
    cursorRef.current.style.left = `${x}px`;
    cursorRef.current.style.top = `${y}px`;

    return () => {
      unsubscribe();
      if (movementTimeoutRef.current) {
        clearTimeout(movementTimeoutRef.current);
      }
    };
  }, [lineHeight, gutterWidth, scrollTop, scrollLeft, charWidth, visible, showLineNumbers]);

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
