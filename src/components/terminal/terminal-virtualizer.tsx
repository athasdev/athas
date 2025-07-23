import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TerminalRenderer } from "./terminal-renderer";

interface LineItem {
  lexeme: string;
  width: number;
  is_underline: boolean;
  is_bold: boolean;
  is_italic: boolean;
  background_color?: any;
  foreground_color?: any;
}

interface VirtualizedTerminalProps {
  screen: LineItem[][];
  cursorLine: number;
  cursorCol: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

const LINE_HEIGHT = 14; // Height of each terminal line in pixels
const OVERSCAN = 10; // Number of lines to render outside visible area

export const VirtualizedTerminal = ({
  screen,
  cursorLine,
  cursorCol,
  containerRef,
}: VirtualizedTerminalProps) => {
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 50 });
  const scrollPositionRef = useRef(0);

  // Calculate visible lines based on scroll position
  const updateVisibleRange = useCallback(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const scrollTop = container.scrollTop;
    const containerHeight = container.clientHeight;

    const startLine = Math.max(0, Math.floor(scrollTop / LINE_HEIGHT) - OVERSCAN);
    const endLine = Math.min(
      screen.length,
      Math.ceil((scrollTop + containerHeight) / LINE_HEIGHT) + OVERSCAN,
    );

    setVisibleRange({ start: startLine, end: endLine });
    scrollPositionRef.current = scrollTop;
  }, [screen.length, containerRef]);

  // Update visible range on scroll
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      requestAnimationFrame(updateVisibleRange);
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    updateVisibleRange(); // Initial calculation

    return () => {
      container.removeEventListener("scroll", handleScroll);
    };
  }, [updateVisibleRange, containerRef]);

  // Update visible range when screen changes
  useEffect(() => {
    updateVisibleRange();
  }, [screen, updateVisibleRange]);

  // Create virtualized content
  const virtualizedContent = useMemo(() => {
    const totalHeight = screen.length * LINE_HEIGHT;
    const offsetY = visibleRange.start * LINE_HEIGHT;
    const visibleLines = screen.slice(visibleRange.start, visibleRange.end);

    return {
      totalHeight,
      offsetY,
      visibleLines,
    };
  }, [screen, visibleRange]);

  // Ensure cursor is visible
  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const cursorTop = cursorLine * LINE_HEIGHT;
    const cursorBottom = cursorTop + LINE_HEIGHT;
    const scrollTop = container.scrollTop;
    const scrollBottom = scrollTop + container.clientHeight;

    // Auto-scroll to keep cursor visible
    if (cursorBottom > scrollBottom - LINE_HEIGHT * 2) {
      // Cursor is near bottom, scroll down
      container.scrollTop = cursorBottom - container.clientHeight + LINE_HEIGHT * 2;
    } else if (cursorTop < scrollTop + LINE_HEIGHT) {
      // Cursor is near top, scroll up
      container.scrollTop = Math.max(0, cursorTop - LINE_HEIGHT);
    }
  }, [cursorLine, containerRef]);

  return (
    <div
      style={{
        height: `${virtualizedContent.totalHeight}px`,
        position: "relative",
      }}
    >
      <div
        style={{
          transform: `translateY(${virtualizedContent.offsetY}px)`,
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
        }}
      >
        <TerminalRenderer
          screen={virtualizedContent.visibleLines}
          cursorLine={cursorLine - visibleRange.start}
          cursorCol={cursorCol}
        />
      </div>
    </div>
  );
};
