/**
 * Search Highlight Layer - Renders search match highlights
 * Shows all matches with yellow background, current match with orange
 *
 * Uses the same single-div + manual padding + in-component measurement span
 * pattern as VimCursorLayer for consistent, accurate font metrics.
 */

import { forwardRef, memo, useEffect, useMemo, useRef, useState } from "react";
import { EDITOR_CONSTANTS } from "../../config/constants";
import { buildLineOffsetMap } from "../../utils/html";

interface SearchMatch {
  start: number;
  end: number;
}

interface SearchHighlightLayerProps {
  searchMatches: SearchMatch[];
  currentMatchIndex: number;
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  tabSize: number;
  content: string;
  viewportRange?: { startLine: number; endLine: number };
}

interface HighlightBox {
  top: number;
  left: number;
  width: number;
  height: number;
  isCurrent: boolean;
}

const VIEWPORT_BUFFER_LINES = 20;

function findLineForOffset(offset: number, lineOffsets: number[]): number {
  if (lineOffsets.length === 0) return 0;

  let low = 0;
  let high = lineOffsets.length - 1;
  let result = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lineOffsets[mid] <= offset) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return result;
}

function offsetToLineColumn(
  offset: number,
  lineOffsets: number[],
  contentLength: number,
): { line: number; column: number } {
  const clampedOffset = Math.max(0, Math.min(offset, contentLength));
  const line = findLineForOffset(clampedOffset, lineOffsets);
  const lineStartOffset = lineOffsets[line] ?? 0;

  return {
    line,
    column: Math.max(0, clampedOffset - lineStartOffset),
  };
}

const SearchHighlightLayerComponent = forwardRef<HTMLDivElement, SearchHighlightLayerProps>(
  (
    {
      searchMatches,
      currentMatchIndex,
      fontSize,
      fontFamily,
      lineHeight,
      tabSize,
      content,
      viewportRange,
    },
    ref,
  ) => {
    const lines = useMemo(() => content.split("\n"), [content]);
    const lineOffsets = useMemo(() => buildLineOffsetMap(content), [content]);
    const measureRef = useRef<HTMLSpanElement>(null);
    const [highlightBoxes, setHighlightBoxes] = useState<HighlightBox[]>([]);

    // Compute highlight boxes in useEffect so measureRef is available
    useEffect(() => {
      if (!measureRef.current) return;

      const measure = measureRef.current;
      const boxes: HighlightBox[] = [];
      const viewportStartLine = Math.max(
        0,
        (viewportRange?.startLine ?? 0) - VIEWPORT_BUFFER_LINES,
      );
      const viewportEndLine = Math.min(
        lines.length,
        (viewportRange?.endLine ?? lines.length) + VIEWPORT_BUFFER_LINES,
      );

      const getTextWidth = (text: string): number => {
        measure.textContent = text;
        return measure.getBoundingClientRect().width;
      };

      const getPosition = (line: number, column: number): { top: number; left: number } => {
        const top = line * lineHeight + EDITOR_CONSTANTS.EDITOR_PADDING_TOP;
        const lineText = lines[line] || "";
        const textBeforeColumn = lineText.substring(0, column);
        const width = getTextWidth(textBeforeColumn);
        return { top, left: width + EDITOR_CONSTANTS.EDITOR_PADDING_LEFT };
      };

      searchMatches.forEach((match, matchIndex) => {
        const startPos = offsetToLineColumn(match.start, lineOffsets, content.length);
        const endPos = offsetToLineColumn(match.end, lineOffsets, content.length);
        const overlapEndLine = findLineForOffset(Math.max(match.start, match.end - 1), lineOffsets);

        if (
          startPos.line >= viewportEndLine ||
          overlapEndLine < viewportStartLine ||
          viewportEndLine <= viewportStartLine
        ) {
          return;
        }

        const isCurrent = matchIndex === currentMatchIndex;

        if (startPos.line === endPos.line) {
          if (startPos.line < viewportStartLine || startPos.line >= viewportEndLine) {
            return;
          }

          const { top, left } = getPosition(startPos.line, startPos.column);
          const lineText = lines[startPos.line] || "";
          const matchText = lineText.substring(startPos.column, endPos.column);
          const width = getTextWidth(matchText);

          boxes.push({
            top,
            left,
            width: Math.max(width, 2),
            height: lineHeight,
            isCurrent,
          });
        } else {
          const firstVisibleLine = Math.max(startPos.line, viewportStartLine);
          const lastVisibleLine = Math.min(endPos.line, viewportEndLine - 1);

          for (let line = firstVisibleLine; line <= lastVisibleLine; line++) {
            const lineText = lines[line] || "";
            let startCol: number;
            let endCol: number;

            if (line === startPos.line) {
              startCol = startPos.column;
              endCol = lineText.length;
            } else if (line === endPos.line) {
              startCol = 0;
              endCol = endPos.column;
            } else {
              startCol = 0;
              endCol = lineText.length;
            }

            const { top, left } = getPosition(line, startCol);
            const matchText = lineText.substring(startCol, endCol);
            const width = getTextWidth(matchText);

            if (width > 0) {
              boxes.push({
                top,
                left,
                width,
                height: lineHeight,
                isCurrent,
              });
            }
          }
        }
      });

      setHighlightBoxes(boxes);
    }, [
      searchMatches,
      currentMatchIndex,
      content,
      lineOffsets,
      lines,
      lineHeight,
      fontSize,
      fontFamily,
      tabSize,
      viewportRange,
    ]);

    if (searchMatches.length === 0) return null;

    return (
      <div
        ref={ref}
        className="search-highlight-layer pointer-events-none absolute inset-0 z-10"
        style={{ willChange: "transform" }}
      >
        {/* Hidden measurement span — lives in the editor DOM for accurate font metrics */}
        <span
          ref={measureRef}
          aria-hidden="true"
          style={{
            position: "absolute",
            visibility: "hidden",
            whiteSpace: "pre",
            fontSize: `${fontSize}px`,
            fontFamily,
            tabSize,
          }}
        />
        {highlightBoxes.map((box, index) => (
          <div
            key={index}
            className={box.isCurrent ? "search-highlight-current" : "search-highlight"}
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

SearchHighlightLayerComponent.displayName = "SearchHighlightLayer";

export const SearchHighlightLayer = memo(SearchHighlightLayerComponent, (prev, next) => {
  return (
    prev.searchMatches === next.searchMatches &&
    prev.currentMatchIndex === next.currentMatchIndex &&
    prev.fontSize === next.fontSize &&
    prev.fontFamily === next.fontFamily &&
    prev.lineHeight === next.lineHeight &&
    prev.tabSize === next.tabSize &&
    prev.content === next.content &&
    prev.viewportRange?.startLine === next.viewportRange?.startLine &&
    prev.viewportRange?.endLine === next.viewportRange?.endLine
  );
});
