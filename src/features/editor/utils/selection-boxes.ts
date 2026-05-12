import { EDITOR_CONSTANTS } from "../config/constants";
import { calculateLineColumnFromOffsets } from "./position";
import type { EditorViewLayout, ViewLineSegment } from "../view-model/view-layout";

export interface SelectionOffsets {
  start: number;
  end: number;
}

export interface SelectionBox {
  top: number;
  left: number;
  width: number;
  height: number;
  corners: {
    topLeft: boolean;
    topRight: boolean;
    bottomRight: boolean;
    bottomLeft: boolean;
  };
}

export interface CalculateSelectionBoxesOptions {
  selectionOffsets: SelectionOffsets;
  lines: string[];
  lineOffsets: number[];
  contentLength: number;
  lineHeight: number;
  measureText: (text: string) => number;
  lineTextResolver?: (lineIndex: number) => string;
  viewportRange?: { startLine: number; endLine: number };
  viewLayout?: EditorViewLayout;
}

export function addSelectionBoxCorners(
  boxes: Array<Omit<SelectionBox, "corners">>,
): SelectionBox[] {
  const epsilon = 0.5;

  return boxes.map((box, index) => {
    const previous = boxes[index - 1];
    const next = boxes[index + 1];
    const isJoinedToPrevious =
      !!previous && Math.abs(previous.top + previous.height - box.top) <= epsilon;
    const isJoinedToNext = !!next && Math.abs(box.top + box.height - next.top) <= epsilon;

    return {
      ...box,
      corners: {
        topLeft: !isJoinedToPrevious,
        topRight: !isJoinedToPrevious,
        bottomRight: !isJoinedToNext,
        bottomLeft: !isJoinedToNext,
      },
    };
  });
}

export function calculateSelectionBoxes({
  selectionOffsets,
  lines,
  lineOffsets,
  contentLength,
  lineHeight,
  measureText,
  lineTextResolver,
  viewportRange,
  viewLayout,
}: CalculateSelectionBoxesOptions): SelectionBox[] {
  const boxes: Array<Omit<SelectionBox, "corners">> = [];
  const minimumSelectionWidth = Math.max(measureText(" "), 4);
  const getLineText = (lineIndex: number) =>
    lineTextResolver?.(lineIndex) ?? lines[lineIndex] ?? "";

  const getLineLeft = (lineIndex: number, column: number): number => {
    const lineText = getLineText(lineIndex);
    const textBeforeColumn = lineText.substring(0, column);
    return measureText(textBeforeColumn) + EDITOR_CONSTANTS.EDITOR_PADDING_LEFT;
  };

  const startPos = calculateLineColumnFromOffsets(
    selectionOffsets.start,
    lineOffsets,
    contentLength,
  );
  const endPos = calculateLineColumnFromOffsets(selectionOffsets.end, lineOffsets, contentLength);
  const firstRenderedLine = Math.max(startPos.line, viewportRange?.startLine ?? startPos.line);
  const lastRenderedLine = Math.min(endPos.line, (viewportRange?.endLine ?? endPos.line + 1) - 1);

  if (firstRenderedLine > lastRenderedLine) {
    return [];
  }

  const addWrappedLineBoxes = (
    line: number,
    startCol: number,
    endCol: number,
    hasSelectedLineBreak: boolean,
  ) => {
    if (!viewLayout) return false;

    const lineText = getLineText(line);
    const lineStartViewLine = viewLayout.modelLineStartViewLines[line] ?? line;
    const lineViewLineCount = viewLayout.modelLineViewLineCounts[line] ?? 1;
    const lineEndViewLine = lineStartViewLine + lineViewLineCount - 1;
    let addedBox = false;

    const addSegmentBox = (segment: ViewLineSegment, boxStartCol: number, boxEndCol: number) => {
      const textBeforeStart = lineText.substring(segment.startColumn, boxStartCol);
      const selectedText = lineText.substring(boxStartCol, boxEndCol);
      const width = selectedText.length > 0 ? measureText(selectedText) : minimumSelectionWidth;

      boxes.push({
        top: segment.top,
        left: measureText(textBeforeStart) + EDITOR_CONSTANTS.EDITOR_PADDING_LEFT,
        width: Math.max(width, minimumSelectionWidth),
        height: segment.height,
      });
      addedBox = true;
    };

    for (let viewLine = lineStartViewLine; viewLine <= lineEndViewLine; viewLine++) {
      const segment = viewLayout.viewLineToSegment(viewLine);
      if (segment.modelLine !== line) continue;

      const boxStartCol = Math.max(startCol, segment.startColumn);
      const boxEndCol = Math.min(endCol, segment.endColumn);

      if (boxEndCol > boxStartCol) {
        addSegmentBox(segment, boxStartCol, boxEndCol);
      }
    }

    if (!addedBox && hasSelectedLineBreak) {
      const segment = viewLayout.getSegmentForModelPosition(line, endCol);
      addSegmentBox(segment, endCol, endCol);
    }

    return true;
  };

  for (let line = firstRenderedLine; line <= lastRenderedLine; line++) {
    const lineText = getLineText(line);
    let startCol = 0;
    let endCol = lineText.length;

    if (startPos.line === endPos.line) {
      startCol = startPos.column;
      endCol = endPos.column;
    } else if (line === startPos.line) {
      startCol = startPos.column;
      endCol = lineText.length;
    } else if (line === endPos.line) {
      startCol = 0;
      endCol = endPos.column;
    }

    const hasSelectedLineBreak = line < endPos.line;

    if (endCol <= startCol && !hasSelectedLineBreak) {
      continue;
    }

    if (addWrappedLineBoxes(line, startCol, endCol, hasSelectedLineBreak)) {
      continue;
    }

    const selectedText = lineText.substring(startCol, endCol);
    const width = selectedText.length > 0 ? measureText(selectedText) : minimumSelectionWidth;

    boxes.push({
      top: line * lineHeight + EDITOR_CONSTANTS.EDITOR_PADDING_TOP,
      left: getLineLeft(line, startCol),
      width: Math.max(width, minimumSelectionWidth),
      height: lineHeight,
    });
  }

  return addSelectionBoxCorners(boxes);
}
