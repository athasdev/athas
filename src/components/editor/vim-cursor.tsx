import type React from "react";
import { useMemo } from "react";

interface VimCursorProps {
  editorRef: React.RefObject<HTMLDivElement | null>;
  cursorPosition: number;
  visible: boolean;
  fontSize: number;
  lineNumbers: boolean;
}

export const VimCursor = ({
  editorRef,
  cursorPosition,
  visible,
  fontSize,
  lineNumbers,
}: VimCursorProps) => {
  const cursorStyle = useMemo(() => {
    if (!editorRef.current || !visible) {
      return { display: "none" };
    }

    const editor = editorRef.current;
    const text = editor.textContent || "";
    const textBeforeCursor = text.substring(0, cursorPosition);
    const lines = textBeforeCursor.split("\n");
    const currentLineIndex = lines.length - 1;
    const currentLineText = lines[currentLineIndex];

    const lineHeight = fontSize * 1.4;
    const charWidth = fontSize * 0.6;
    const paddingTop = 16;
    const paddingLeft = lineNumbers ? 16 : 16;

    const top = currentLineIndex * lineHeight + paddingTop;
    const left = currentLineText.length * charWidth + paddingLeft;

    return {
      position: "absolute" as const,
      top: `${top}px`,
      left: `${left}px`,
      width: `${charWidth}px`,
      height: `${lineHeight}px`,
      backgroundColor: "var(--text-color)",
      opacity: 0.7,
      pointerEvents: "none" as const,
      zIndex: 3,
      border: "1px solid var(--text-color)",
      boxSizing: "border-box" as const,
    };
  }, [editorRef, cursorPosition, visible, fontSize, lineNumbers]);

  return <div style={cursorStyle} />;
};
