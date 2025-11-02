import type React from "react";
import { forwardRef, memo, useCallback, useMemo, useRef, useState } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { useEditorLayout } from "@/features/editor/hooks/use-layout";
import { useEditorSettingsStore } from "@/features/editor/stores/settings-store";
import { useEditorStateStore } from "@/features/editor/stores/state-store";
import { useEditorViewStore } from "@/features/editor/stores/view-store";
import { useZoomStore } from "@/stores/zoom-store";
import { getLineRenderWidth, getScrollbarSize } from "@/utils/editor-position";
import { LineWithContent } from "./line-with-content";

interface EditorViewportProps {
  onScroll?: (scrollTop: number, scrollLeft: number) => void;
  onClick?: (e: React.MouseEvent<HTMLElement>) => void;
  onMouseDown?: (e: React.MouseEvent<HTMLElement>) => void;
  onMouseMove?: (e: React.MouseEvent<HTMLElement>) => void;
  onMouseUp?: (e: React.MouseEvent<HTMLElement>) => void;
  onContextMenu?: (e: React.MouseEvent<HTMLElement>) => void;
  onGitIndicatorClick?: (lineNumber: number, changeType: string) => void;
}

const EditorViewportComponent = (
  {
    onScroll,
    onClick,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    onContextMenu,
    onGitIndicatorClick,
  }: EditorViewportProps,
  forwardedRef: React.ForwardedRef<HTMLDivElement>,
) => {
  const lineCount = useEditorViewStore((state) => state.lines.length);
  const showLineNumbers = useEditorSettingsStore.use.lineNumbers();
  const fontSize = useEditorSettingsStore.use.fontSize();
  const fontFamily = useEditorSettingsStore.use.fontFamily();
  const viewportHeight = useEditorStateStore.use.viewportHeight();
  const tabSize = useEditorSettingsStore.use.tabSize();
  const { lineHeight, gutterWidth } = useEditorLayout();
  const lines = useEditorViewStore.use.lines();
  const editorZoomLevel = useZoomStore.use.editorZoomLevel();
  const internalRef = useRef<HTMLDivElement | null>(null);

  const setContainerRef = useCallback(
    (node: HTMLDivElement | null) => {
      internalRef.current = node;
      if (!forwardedRef) return;

      if (typeof forwardedRef === "function") {
        forwardedRef(node);
      } else {
        (forwardedRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }
    },
    [forwardedRef],
  );

  // Keep scroll state local to avoid excessive global updates

  const [localScrollTop, setLocalScrollTop] = useState(0);

  const effectiveFontFamily = fontFamily
    ? `${fontFamily}, JetBrains Mono, monospace`
    : "JetBrains Mono, monospace";

  const maxLineContentWidth = useMemo(() => {
    if (!lines || lines.length === 0) {
      return 0;
    }

    let maxWidth = 0;
    for (const line of lines) {
      const width = getLineRenderWidth(line, fontSize, effectiveFontFamily, tabSize);
      if (width > maxWidth) {
        maxWidth = width;
      }
    }

    return maxWidth;
  }, [lines, fontSize, effectiveFontFamily, tabSize]);

  const gutterAreaWidth = showLineNumbers ? gutterWidth : 16;
  const contentPadding = showLineNumbers
    ? EDITOR_CONSTANTS.GUTTER_MARGIN
    : 2 * EDITOR_CONSTANTS.GUTTER_MARGIN;
  const paddedContentWidth = Math.max(
    gutterAreaWidth + contentPadding + maxLineContentWidth + 32,
    gutterAreaWidth + contentPadding + 32,
  );

  const _scrollbarSize = useMemo(() => getScrollbarSize(editorZoomLevel), [editorZoomLevel]);

  const visibleRange = useMemo(() => {
    // Use the local scroll position for visible range calculation
    const actualScrollTop = localScrollTop;
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
  }, [localScrollTop, lineHeight, viewportHeight, lineCount]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const newScrollTop = target.scrollTop;
    const newScrollLeft = target.scrollLeft;

    // Update immediately for snappier scrolling
    setLocalScrollTop(newScrollTop);

    // Notify parent component (but parent no longer updates store)
    onScroll?.(newScrollTop, newScrollLeft);
  };

  const totalHeight = lineCount * lineHeight + 20 * lineHeight; // Add 20 lines of empty space at bottom

  return (
    <div
      ref={setContainerRef}
      className="editor-viewport editor-scrollable"
      onScroll={handleScroll}
      style={{
        position: "relative",
        overflowX: "hidden",
        overflowY: "auto",
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
          width: `${Math.ceil(paddedContentWidth)}px`,
          zIndex: 1,
          tabSize: tabSize ?? 2,
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
              onGitIndicatorClick={onGitIndicatorClick}
            />
          );
        })}
      </div>
    </div>
  );
};

export const EditorViewport = memo(
  forwardRef<HTMLDivElement, EditorViewportProps>(EditorViewportComponent),
);

EditorViewport.displayName = "EditorViewport";
