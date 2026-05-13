/**
 * Search Highlight Layer - Renders search match highlights
 * Shows all matches with yellow background, current match with orange
 *
 * Uses cached canvas text measurement to avoid forcing layout while search
 * matches are mapped into overlay boxes.
 */

import { forwardRef, memo, useMemo } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import {
  calculateLineColumnFromOffsets,
  findLineIndexForOffset,
  measureTextWidth,
} from "@/features/athas-editor/utils/position";
import { calculateSelectionBoxes } from "@/features/athas-editor/utils/selection-boxes";
import {
  getSearchMatchesInOffsetRange,
  getSearchViewportOffsetRange,
} from "@/features/athas-editor/utils/search";
import type { EditorViewLayout } from "@/features/athas-editor/view-model/view-layout";

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
  lines: string[];
  lineOffsets: number[];
  contentLength: number;
  lineCount?: number;
  lineTextResolver?: (lineIndex: number) => string;
  viewportRange?: { startLine: number; endLine: number };
  viewLayout?: EditorViewLayout;
}

interface HighlightBox {
  top: number;
  left: number;
  width: number;
  height: number;
  isCurrent: boolean;
}

const VIEWPORT_BUFFER_LINES = 20;

const SearchHighlightLayerComponent = forwardRef<HTMLDivElement, SearchHighlightLayerProps>(
  (
    {
      searchMatches,
      currentMatchIndex,
      fontSize,
      fontFamily,
      lineHeight,
      tabSize,
      lines,
      lineOffsets,
      contentLength,
      lineCount,
      lineTextResolver,
      viewportRange,
      viewLayout,
    },
    ref,
  ) => {
    const highlightBoxes = useMemo<HighlightBox[]>(() => {
      const boxes: HighlightBox[] = [];
      const totalLines = lineCount ?? lines.length;
      const viewportStartLine = Math.max(
        0,
        (viewportRange?.startLine ?? 0) - VIEWPORT_BUFFER_LINES,
      );
      const viewportEndLine = Math.min(
        totalLines,
        (viewportRange?.endLine ?? totalLines) + VIEWPORT_BUFFER_LINES,
      );
      const viewportOffsetRange = getSearchViewportOffsetRange(
        lineOffsets,
        contentLength,
        viewportStartLine,
        viewportEndLine,
      );
      const visibleMatches = getSearchMatchesInOffsetRange(searchMatches, viewportOffsetRange);

      const getTextWidth = (text: string): number => {
        return measureTextWidth(text, fontSize, fontFamily, tabSize);
      };

      if (viewLayout) {
        visibleMatches.forEach(({ match, index: matchIndex }) => {
          const isCurrent = matchIndex === currentMatchIndex;
          const matchBoxes = calculateSelectionBoxes({
            selectionOffsets: {
              start: Math.min(match.start, match.end),
              end: Math.max(match.start, match.end),
            },
            lines,
            lineOffsets,
            contentLength,
            lineHeight,
            measureText: getTextWidth,
            viewportRange: {
              startLine: viewportStartLine,
              endLine: viewportEndLine,
            },
            viewLayout,
          });

          boxes.push(
            ...matchBoxes.map((box) => ({
              top: box.top,
              left: box.left,
              width: box.width,
              height: box.height,
              isCurrent,
            })),
          );
        });

        return boxes;
      }

      const getPosition = (line: number, column: number): { top: number; left: number } => {
        const top = line * lineHeight + EDITOR_CONSTANTS.EDITOR_PADDING_TOP;
        const lineText = lineTextResolver?.(line) ?? lines[line] ?? "";
        const textBeforeColumn = lineText.substring(0, column);
        const width = getTextWidth(textBeforeColumn);
        return { top, left: width + EDITOR_CONSTANTS.EDITOR_PADDING_LEFT };
      };

      visibleMatches.forEach(({ match, index: matchIndex }) => {
        const startPos = calculateLineColumnFromOffsets(match.start, lineOffsets, contentLength);
        const endPos = calculateLineColumnFromOffsets(match.end, lineOffsets, contentLength);
        const overlapEndLine = findLineIndexForOffset(
          lineOffsets,
          Math.max(match.start, match.end - 1),
        );

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
          const lineText = lineTextResolver?.(startPos.line) ?? lines[startPos.line] ?? "";
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
            const lineText = lineTextResolver?.(line) ?? lines[line] ?? "";
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

      return boxes;
    }, [
      contentLength,
      currentMatchIndex,
      fontFamily,
      fontSize,
      lineCount,
      lineHeight,
      lineOffsets,
      lineTextResolver,
      lines,
      searchMatches,
      tabSize,
      viewportRange,
      viewLayout,
    ]);

    if (searchMatches.length === 0) return null;

    return (
      <div
        ref={ref}
        className="search-highlight-layer pointer-events-none absolute inset-0 z-10"
        style={{ willChange: "transform" }}
      >
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
    prev.lines === next.lines &&
    prev.lineOffsets === next.lineOffsets &&
    prev.contentLength === next.contentLength &&
    prev.lineCount === next.lineCount &&
    prev.lineTextResolver === next.lineTextResolver &&
    prev.viewLayout === next.viewLayout &&
    prev.viewportRange?.startLine === next.viewportRange?.startLine &&
    prev.viewportRange?.endLine === next.viewportRange?.endLine
  );
});
