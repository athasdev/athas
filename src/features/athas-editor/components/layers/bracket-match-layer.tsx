import { forwardRef, memo, useMemo } from "react";
import { findMatchingBracketAtCursor } from "@/features/athas-editor/utils/bracket-matching";
import { measureTextWidth } from "@/features/athas-editor/utils/position";
import {
  calculateSelectionBoxes,
  type SelectionBox,
} from "@/features/athas-editor/utils/selection-boxes";
import type { EditorViewLayout } from "@/features/athas-editor/view-model/view-layout";

interface BracketMatchLayerProps {
  content: string;
  cursorOffset: number;
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

interface BracketBox extends SelectionBox {
  kind: "active" | "matching" | "unmatched";
}

const BracketMatchLayerComponent = forwardRef<HTMLDivElement, BracketMatchLayerProps>(
  (
    {
      content,
      cursorOffset,
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
    const boxes = useMemo(() => {
      if (content.length === 0) return [];

      const match = findMatchingBracketAtCursor(content, cursorOffset);
      if (!match) return [];

      const measureText = (text: string): number => {
        return measureTextWidth(text, fontSize, fontFamily, tabSize);
      };
      const nextBoxes: BracketBox[] = [];
      const addBox = (offset: number, kind: BracketBox["kind"]) => {
        const selectionBoxes = calculateSelectionBoxes({
          selectionOffsets: { start: offset, end: Math.min(contentLength, offset + 1) },
          lines,
          lineOffsets,
          contentLength,
          lineHeight,
          measureText,
          lineTextResolver,
          viewportRange,
          viewLayout,
        });

        nextBoxes.push(...selectionBoxes.map((box) => ({ ...box, kind })));
      };

      addBox(match.activeOffset, match.matchingOffset === null ? "unmatched" : "active");
      if (match.matchingOffset !== null) {
        addBox(match.matchingOffset, "matching");
      }

      return nextBoxes;
    }, [
      content,
      contentLength,
      cursorOffset,
      fontFamily,
      fontSize,
      lineHeight,
      lineOffsets,
      lineTextResolver,
      lines,
      tabSize,
      viewportRange,
      viewLayout,
    ]);

    if (boxes.length === 0) return null;

    return (
      <div
        ref={ref}
        className="bracket-match-layer pointer-events-none absolute inset-0 z-[9]"
        style={{ willChange: "transform" }}
      >
        {boxes.map((box, index) => (
          <div
            key={`${box.kind}-${index}`}
            className={`editor-bracket-match editor-bracket-match-${box.kind}`}
            style={{
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

BracketMatchLayerComponent.displayName = "BracketMatchLayer";

export const BracketMatchLayer = memo(BracketMatchLayerComponent, (prev, next) => {
  return (
    prev.content === next.content &&
    prev.cursorOffset === next.cursorOffset &&
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
