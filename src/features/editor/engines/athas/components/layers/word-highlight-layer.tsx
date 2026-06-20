import { forwardRef, memo, useMemo } from "react";
import { measureTextWidth } from "@/features/editor/utils/position";
import { calculateSelectionBoxes } from "@/features/editor/engines/athas/utils/selection-boxes";
import { findWordHighlightRanges } from "@/features/editor/engines/athas/utils/word-highlight";
import type { EditorViewLayout } from "@/features/editor/view-model/view-layout";

interface WordHighlightLayerProps {
  content: string;
  cursorOffset: number;
  hasSelection?: boolean;
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  tabSize: number;
  lines: string[];
  lineOffsets: number[];
  contentLength: number;
  lineTextResolver?: (lineIndex: number) => string;
  viewportRange?: { startLine: number; endLine: number };
  viewLayout?: EditorViewLayout;
}

interface WordHighlightBox {
  top: number;
  left: number;
  width: number;
  height: number;
  isCurrent: boolean;
}

const WordHighlightLayerComponent = forwardRef<HTMLDivElement, WordHighlightLayerProps>(
  (
    {
      content,
      cursorOffset,
      hasSelection = false,
      fontSize,
      fontFamily,
      lineHeight,
      tabSize,
      lines,
      lineOffsets,
      contentLength,
      lineTextResolver,
      viewportRange,
      viewLayout,
    },
    ref,
  ) => {
    const highlightBoxes = useMemo<WordHighlightBox[]>(() => {
      if (hasSelection || content.length === 0) return [];

      const measureText = (text: string): number =>
        measureTextWidth(text, fontSize, fontFamily, tabSize);
      const ranges = findWordHighlightRanges({
        content,
        cursorOffset,
        lineOffsets,
        viewportRange,
      });

      return ranges
        .filter((range) => !range.isCurrent)
        .flatMap((range) =>
          calculateSelectionBoxes({
            selectionOffsets: {
              start: range.start,
              end: range.end,
            },
            lines,
            lineOffsets,
            contentLength,
            lineHeight,
            measureText,
            lineTextResolver,
            viewportRange,
            viewLayout,
          }).map((box) => ({
            top: box.top,
            left: box.left,
            width: box.width,
            height: box.height,
            isCurrent: range.isCurrent,
          })),
        );
    }, [
      content,
      contentLength,
      cursorOffset,
      fontFamily,
      fontSize,
      hasSelection,
      lineHeight,
      lineOffsets,
      lineTextResolver,
      lines,
      tabSize,
      viewportRange,
      viewLayout,
    ]);

    if (highlightBoxes.length === 0) return null;

    return (
      <div
        ref={ref}
        className="word-highlight-layer pointer-events-none absolute inset-0 z-[8]"
        style={{ willChange: "transform" }}
      >
        {highlightBoxes.map((box, index) => (
          <div
            key={index}
            className={box.isCurrent ? "editor-word-highlight-current" : "editor-word-highlight"}
            style={{
              position: "absolute",
              top: `${box.top}px`,
              left: `${box.left}px`,
              width: `${box.width}px`,
              height: `${box.height}px`,
            }}
          />
        ))}
      </div>
    );
  },
);

WordHighlightLayerComponent.displayName = "WordHighlightLayer";

export const WordHighlightLayer = memo(WordHighlightLayerComponent, (prev, next) => {
  return (
    prev.content === next.content &&
    prev.cursorOffset === next.cursorOffset &&
    prev.hasSelection === next.hasSelection &&
    prev.fontSize === next.fontSize &&
    prev.fontFamily === next.fontFamily &&
    prev.lineHeight === next.lineHeight &&
    prev.tabSize === next.tabSize &&
    prev.lines === next.lines &&
    prev.lineOffsets === next.lineOffsets &&
    prev.contentLength === next.contentLength &&
    prev.lineTextResolver === next.lineTextResolver &&
    prev.viewportRange?.startLine === next.viewportRange?.startLine &&
    prev.viewportRange?.endLine === next.viewportRange?.endLine &&
    prev.viewLayout === next.viewLayout
  );
});
