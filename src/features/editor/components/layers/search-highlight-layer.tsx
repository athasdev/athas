/**
 * Search Highlight Layer - Renders search match highlights
 * Shows all matches with yellow background, current match with orange
 *
 * Uses the same single-div + manual padding + in-component measurement span
 * pattern as VimCursorLayer for consistent, accurate font metrics.
 */

import { forwardRef, memo, useEffect, useMemo, useRef, useState } from "react";
import { EDITOR_CONSTANTS } from "../../config/constants";

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
}

interface HighlightBox {
  top: number;
  left: number;
  width: number;
  height: number;
  isCurrent: boolean;
}

// Convert character offset to line and column
function offsetToLineColumn(content: string, offset: number): { line: number; column: number } {
  let line = 0;
  let column = 0;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === "\n") {
      line++;
      column = 0;
    } else {
      column++;
    }
  }
  return { line, column };
}

const SearchHighlightLayerComponent = forwardRef<HTMLDivElement, SearchHighlightLayerProps>(
  (
    { searchMatches, currentMatchIndex, fontSize, fontFamily, lineHeight, tabSize, content },
    ref,
  ) => {
    const lines = useMemo(() => content.split("\n"), [content]);
    const measureRef = useRef<HTMLSpanElement>(null);
    const [highlightBoxes, setHighlightBoxes] = useState<HighlightBox[]>([]);

    // Compute highlight boxes in useEffect so measureRef is available
    useEffect(() => {
      if (!measureRef.current) return;

      const measure = measureRef.current;
      const boxes: HighlightBox[] = [];

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
        const startPos = offsetToLineColumn(content, match.start);
        const endPos = offsetToLineColumn(content, match.end);
        const isCurrent = matchIndex === currentMatchIndex;

        if (startPos.line === endPos.line) {
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
          for (let line = startPos.line; line <= endPos.line; line++) {
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
      lines,
      lineHeight,
      fontSize,
      fontFamily,
      tabSize,
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
    prev.content === next.content
  );
});
