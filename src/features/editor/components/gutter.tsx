/**
 * Line number gutter
 */

import { forwardRef } from "react";
import { useEditorStateStore } from "../stores/state-store";

interface GutterProps {
  lines: string[];
  fontSize: number;
  fontFamily: string;
}

export const Gutter = forwardRef<HTMLDivElement, GutterProps>(
  ({ lines, fontSize, fontFamily }, ref) => {
    // Subscribe to cursor position directly to avoid parent re-renders
    const activeLine = useEditorStateStore.use.cursorPosition().line;
    const lineHeight = fontSize * 1.4;

    return (
      <div
        ref={ref}
        className="select-none bg-primary-bg"
        style={{
          fontSize: `${fontSize}px`,
          fontFamily,
          lineHeight: `${lineHeight}px`,
          minWidth: "3.5rem",
          borderRight: "1px solid var(--border, rgba(255, 255, 255, 0.06))",
          paddingTop: "0.5rem",
          paddingBottom: "0.5rem",
          height: "100%",
          overflowY: "hidden",
          overflowX: "hidden",
        }}
      >
        {lines.map((_, i) => {
          const isActive = i === activeLine;
          return (
            <div
              key={i}
              className="px-3 text-right transition-all"
              style={{
                color: isActive
                  ? "var(--text, #d4d4d4)"
                  : "var(--text-light, rgba(255, 255, 255, 0.5))",
                opacity: isActive ? 1 : 0.5,
                fontWeight: isActive ? 500 : 400,
                cursor: "pointer",
              }}
            >
              {i + 1}
            </div>
          );
        })}
      </div>
    );
  },
);

Gutter.displayName = "Gutter";
