import { EDITOR_CONSTANTS } from "../config/constants";

export interface SelectionOffsets {
  start: number;
  end: number;
}

export interface SelectionBox {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface CalculateSelectionBoxesOptions {
  selectionOffsets: SelectionOffsets;
  lines: string[];
  lineOffsets: number[];
  contentLength: number;
  lineHeight: number;
  measureText: (text: string) => number;
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

export function calculateSelectionBoxes({
  selectionOffsets,
  lines,
  lineOffsets,
  contentLength,
  lineHeight,
  measureText,
}: CalculateSelectionBoxesOptions): SelectionBox[] {
  const boxes: SelectionBox[] = [];
  const minimumSelectionWidth = Math.max(measureText(" "), 4);

  const getLineLeft = (lineIndex: number, column: number): number => {
    const lineText = lines[lineIndex] || "";
    const textBeforeColumn = lineText.substring(0, column);
    return measureText(textBeforeColumn) + EDITOR_CONSTANTS.EDITOR_PADDING_LEFT;
  };

  const startPos = offsetToLineColumn(selectionOffsets.start, lineOffsets, contentLength);
  const endPos = offsetToLineColumn(selectionOffsets.end, lineOffsets, contentLength);

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

    const selectedText = lineText.substring(startCol, endCol);
    const width = selectedText.length > 0 ? measureText(selectedText) : minimumSelectionWidth;

    boxes.push({
      top: line * lineHeight + EDITOR_CONSTANTS.EDITOR_PADDING_TOP,
      left: getLineLeft(line, startCol),
      width: Math.max(width, minimumSelectionWidth),
      height: lineHeight,
    });
  }

  return boxes;
}
