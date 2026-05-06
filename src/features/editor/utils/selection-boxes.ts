import { EDITOR_CONSTANTS } from "../config/constants";
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
  viewLayout?: EditorViewLayout;
}

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

export function addSelectionBoxCorners(
  boxes: Array<Omit<SelectionBox, "corners">>,
): SelectionBox[] {
  const epsilon = 0.5;

  return boxes.map((box, index) => {
    const previous = boxes[index - 1];
    const next = boxes[index + 1];
    const right = box.left + box.width;
    const previousRight = previous ? previous.left + previous.width : 0;
    const nextRight = next ? next.left + next.width : 0;

    return {
      ...box,
      corners: {
        topLeft: !previous || box.left < previous.left - epsilon,
        topRight: !previous || right > previousRight + epsilon,
        bottomRight: !next || right > nextRight + epsilon,
        bottomLeft: !next || box.left < next.left - epsilon,
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
  viewLayout,
}: CalculateSelectionBoxesOptions): SelectionBox[] {
  const boxes: Array<Omit<SelectionBox, "corners">> = [];
  const minimumSelectionWidth = Math.max(measureText(" "), 4);

  const getLineLeft = (lineIndex: number, column: number): number => {
    const lineText = lines[lineIndex] || "";
    const textBeforeColumn = lineText.substring(0, column);
    return measureText(textBeforeColumn) + EDITOR_CONSTANTS.EDITOR_PADDING_LEFT;
  };

  const startPos = offsetToLineColumn(selectionOffsets.start, lineOffsets, contentLength);
  const endPos = offsetToLineColumn(selectionOffsets.end, lineOffsets, contentLength);

  const addWrappedLineBoxes = (
    line: number,
    startCol: number,
    endCol: number,
    hasSelectedLineBreak: boolean,
  ) => {
    if (!viewLayout) return false;

    const lineText = lines[line] || "";
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

  for (let line = startPos.line; line <= endPos.line; line++) {
    const lineText = lines[line] || "";
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
