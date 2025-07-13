import type React from "react";
import { useEffect, useRef, useState } from "react";

interface InlineCompletionProps {
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  completion: string;
  cursorPosition: number;
  visible: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}

const InlineCompletion = ({
  textareaRef,
  completion,
  cursorPosition,
  visible,
  onAccept,
  onDismiss,
}: InlineCompletionProps) => {
  const [completionStyle, setCompletionStyle] = useState<React.CSSProperties>({});
  const completionRef = useRef<HTMLDivElement>(null);

  // Console logging for debugging
  // console.log('🎯 InlineCompletion render:', {
  //   visible,
  //   hasCompletion: !!completion,
  //   completionLength: completion?.length || 0,
  //   cursorPosition
  // });

  useEffect(() => {
    if (!textareaRef.current || !visible || !completion) {
      setCompletionStyle({ display: "none" });
      return;
    }

    const textarea = textareaRef.current;

    // Get the exact cursor position using browser APIs
    const getCursorPosition = () => {
      // Create a temporary span to measure cursor position
      const span = document.createElement("span");
      span.textContent = "|"; // Cursor character
      span.style.position = "absolute";
      span.style.visibility = "hidden";
      span.style.whiteSpace = "pre";
      span.style.font = window.getComputedStyle(textarea).font;
      span.style.fontFamily = window.getComputedStyle(textarea).fontFamily;
      span.style.fontSize = window.getComputedStyle(textarea).fontSize;
      span.style.lineHeight = window.getComputedStyle(textarea).lineHeight;
      span.style.padding = window.getComputedStyle(textarea).padding;

      document.body.appendChild(span);

      // Get text up to cursor position
      const textBeforeCursor = textarea.value.substring(0, cursorPosition);
      const lines = textBeforeCursor.split("\n");
      const currentLineIndex = lines.length - 1;
      const currentLineText = lines[currentLineIndex];

      // Measure the text width up to cursor
      span.textContent = currentLineText;
      const textWidth = span.offsetWidth;

      // Clean up
      document.body.removeChild(span);

      // Get textarea's position
      const containerRect = textarea.parentElement?.getBoundingClientRect();

      if (!containerRect) return { top: 0, left: 0 };

      // Calculate position relative to the editor container
      const lineHeight = parseInt(window.getComputedStyle(textarea).lineHeight) || 24;
      const paddingLeft = parseInt(window.getComputedStyle(textarea).paddingLeft) || 8;
      const paddingTop = parseInt(window.getComputedStyle(textarea).paddingTop) || 16;

      const top = currentLineIndex * lineHeight + paddingTop;
      const left = textWidth + paddingLeft + 48; // 48px for line numbers

      return { top, left, currentLineIndex, textWidth };
    };

    const position = getCursorPosition();

    setCompletionStyle({
      position: "absolute",
      top: `${position.top}px`,
      left: `${position.left}px`,
      color: "var(--text-lighter)",
      backgroundColor: "transparent",
      padding: "0",
      borderRadius: "0",
      opacity: 0.6,
      pointerEvents: "none",
      zIndex: 5,
      fontFamily: "inherit",
      fontSize: "inherit",
      lineHeight: "inherit",
      whiteSpace: "pre",
      display: "block",
      userSelect: "none",
      border: "none",
      fontStyle: "italic",
    });

    console.log("🎯 Precise cursor positioning:", {
      ...position,
      cursorPosition,
    });
  }, [textareaRef, completion, cursorPosition, visible]);

  // Clean up the completion text
  const cleanCompletion = completion
    .replace(/```\w*\n?/g, "") // Remove code block markers
    .replace(/```/g, "") // Remove closing code blocks
    .replace(/↵/g, "\n") // Replace arrow symbols with actual newlines
    .trim();

  // Debug logging
  useEffect(() => {
    if (visible && cleanCompletion) {
      console.log("🎯 Showing completion:", {
        visible,
        cleanCompletion:
          cleanCompletion.substring(0, 50) + (cleanCompletion.length > 50 ? "..." : ""),
        cursorPosition,
        hasStyle: !!completionStyle.display,
      });
    }
  }, [visible, cleanCompletion, cursorPosition, completionStyle]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!visible) return;

      if (e.key === "Tab" || e.key === "ArrowRight") {
        e.preventDefault();
        console.log("✅ Accepting completion via", e.key);
        onAccept();
      } else if (e.key === "Escape") {
        e.preventDefault();
        console.log("❌ Dismissing completion via Escape");
        onDismiss();
      } else if (e.key.length === 1 || e.key === "Backspace" || e.key === "Delete") {
        // Dismiss on any typing
        console.log("❌ Dismissing completion due to typing:", e.key);
        onDismiss();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [visible, onAccept, onDismiss]);

  if (!visible || !cleanCompletion) {
    return null;
  }

  return (
    <div ref={completionRef} style={completionStyle} title="Press Tab to accept, Esc to dismiss">
      {cleanCompletion}
    </div>
  );
};

export default InlineCompletion;
