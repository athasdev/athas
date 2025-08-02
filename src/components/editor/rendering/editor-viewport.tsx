import type React from "react";
import { forwardRef, memo, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { EDITOR_CONSTANTS } from "../../../constants/editor-constants";
import { useEditorLayout } from "../../../hooks/use-editor-layout";
import { useEditorCursorStore } from "../../../stores/editor-cursor-store";
import { useEditorLayoutStore } from "../../../stores/editor-layout-store";
import { useEditorSettingsStore } from "../../../stores/editor-settings-store";
import { useEditorViewStore } from "../../../stores/editor-view-store";
import { LineWithContent } from "./line-with-content";

interface EditorViewportProps {
  onScroll?: (scrollTop: number, scrollLeft: number) => void;
  onClick?: (e: React.MouseEvent<HTMLElement>) => void;
  onMouseDown?: (e: React.MouseEvent<HTMLElement>) => void;
  onMouseMove?: (e: React.MouseEvent<HTMLElement>) => void;
  onMouseUp?: (e: React.MouseEvent<HTMLElement>) => void;
  onContextMenu?: (e: React.MouseEvent<HTMLElement>) => void;
}

// TODO: use ref as props since we are in React 19
export const EditorViewport = memo(
  forwardRef<HTMLDivElement, EditorViewportProps>(
    ({ onScroll, onClick, onMouseDown, onMouseMove, onMouseUp, onContextMenu }, ref) => {
      const selection = useEditorCursorStore.use.selection?.() ?? undefined;
      const lineCount = useEditorViewStore((state) => state.lines.length);
      const showLineNumbers = useEditorSettingsStore.use.lineNumbers();
      const scrollTop = useEditorLayoutStore.use.scrollTop();
      const viewportHeight = useEditorLayoutStore.use.viewportHeight();
      const { lineHeight, gutterWidth } = useEditorLayout();

      const selectedLines = useMemo(() => {
        const lines = new Set<number>();
        if (selection) {
          for (let i = selection.start.line; i <= selection.end.line; i++) {
            lines.add(i);
          }
        }
        return lines;
      }, [selection]);
      const containerRef = useRef<HTMLDivElement>(null);

      // Expose the container ref to parent components
      useImperativeHandle(ref, () => containerRef.current!, []);

      const [, setIsScrolling] = useState(false);
      const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
      const [, forceUpdate] = useState({});
      const isScrollingRef = useRef(false);

      // Sync scroll position from prop only when not actively scrolling
      useEffect(() => {
        if (containerRef.current && !isScrollingRef.current) {
          containerRef.current.scrollTop = scrollTop;
        }
      }, [scrollTop]);

      const visibleRange = useMemo(() => {
        // Use the actual scroll position from the DOM element if available
        const actualScrollTop = containerRef.current?.scrollTop ?? scrollTop;
        const startLine = Math.floor(actualScrollTop / lineHeight);
        const endLine = Math.ceil((actualScrollTop + viewportHeight) / lineHeight);
        // Dynamic overscan based on viewport size
        const visibleLineCount = endLine - startLine;
        const overscan = Math.max(
          EDITOR_CONSTANTS.MIN_OVERSCAN_LINES,
          Math.ceil(visibleLineCount * EDITOR_CONSTANTS.VIEWPORT_OVERSCAN_RATIO),
        );

        return {
          start: Math.max(0, startLine - overscan),
          end: Math.min(lineCount, endLine + overscan),
        };
      }, [scrollTop, lineHeight, viewportHeight, lineCount, forceUpdate]);

      const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const target = e.currentTarget;
        const newScrollTop = target.scrollTop;
        const newScrollLeft = target.scrollLeft;

        isScrollingRef.current = true;
        setIsScrolling(true);

        // Force re-render to update visible range
        forceUpdate({});

        if (scrollTimeoutRef.current) {
          clearTimeout(scrollTimeoutRef.current);
        }

        scrollTimeoutRef.current = setTimeout(() => {
          setIsScrolling(false);
          isScrollingRef.current = false;
        }, 150);

        // Still notify parent component
        onScroll?.(newScrollTop, newScrollLeft);
      };

      useEffect(() => {
        return () => {
          if (scrollTimeoutRef.current) {
            clearTimeout(scrollTimeoutRef.current);
          }
        };
      }, []);

      const totalHeight = lineCount * lineHeight + 20 * lineHeight; // Add 20 lines of empty space at bottom

      return (
        <div
          ref={containerRef}
          className="editor-viewport"
          onScroll={handleScroll}
          style={{
            position: "relative",
            overflow: "auto",
            height: `${viewportHeight}px`,
          }}
        >
          {/* Gutter background for full height */}
          {showLineNumbers && (
            <div
              className="editor-gutter-background"
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: `${gutterWidth}px`,
                height: `${Math.max(totalHeight, viewportHeight)}px`,
                backgroundColor: "var(--color-gutter-background, rgba(128, 128, 128, 0.05))",
                zIndex: 0,
              }}
            />
          )}
          <div
            className="editor-content"
            style={{
              position: "relative",
              height: `${totalHeight}px`,
              minWidth: "100%",
              zIndex: 1,
            }}
            onClick={onClick}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            onContextMenu={onContextMenu}
          >
            {/* Array.from creates an array of specified length, then maps over
              indices to generate line components */}
            {Array.from({ length: visibleRange.end - visibleRange.start }, (_, i) => {
              const idx = visibleRange.start + i;
              return (
                <LineWithContent
                  key={`line-${idx}`}
                  lineNumber={idx}
                  showLineNumbers={showLineNumbers}
                  gutterWidth={gutterWidth}
                  lineHeight={lineHeight}
                  isSelected={selectedLines.has(idx)}
                />
              );
            })}
          </div>
        </div>
      );
    },
  ),
);

EditorViewport.displayName = "EditorViewport";
