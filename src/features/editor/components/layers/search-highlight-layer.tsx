/**
 * Search Highlight Layer - Renders search match highlights
 * Shows all matches with yellow background, current match with orange
 */

import { forwardRef, memo, useMemo } from "react";
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
  ({ searchMatches, currentMatchIndex, fontSize, fontFamily, lineHeight, content }, ref) => {
    const lines = useMemo(() => content.split("\n"), [content]);

    // Convert matches to highlight boxes
    const highlightBoxes = useMemo((): HighlightBox[] => {
      const boxes: HighlightBox[] = [];

      // Create a hidden element for measuring text width with the actual font
      const measureElement = document.createElement("span");
      measureElement.style.cssText = `
        position: absolute;
        visibility: hidden;
        white-space: pre;
        font-family: ${fontFamily};
        font-size: ${fontSize}px;
      `;
      document.body.appendChild(measureElement);

      // Calculate text width using DOM measurement (more accurate than canvas for custom fonts)
      const getTextWidth = (text: string): number => {
        measureElement.textContent = text;
        return measureElement.getBoundingClientRect().width;
      };

      // Calculate pixel position for a given line and column
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
          // Single line match
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
          // Multi-line match: render a box for each line
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

      // Cleanup measurement element
      document.body.removeChild(measureElement);

      return boxes;
    }, [searchMatches, currentMatchIndex, content, lines, lineHeight, fontSize, fontFamily]);

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
    prev.content === next.content
  );
});
