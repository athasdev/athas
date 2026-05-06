import { EDITOR_CONSTANTS } from "../config/constants";

export interface ViewLineSegment {
  viewLine: number;
  modelLine: number;
  startColumn: number;
  endColumn: number;
  top: number;
  height: number;
}

export interface ViewPosition {
  viewLine: number;
  modelLine: number;
  column: number;
  top: number;
  left: number;
  segment: ViewLineSegment;
}

export interface EditorResolvedPosition extends ViewPosition {
  line: number;
  height: number;
}

export type EditorCoordinateResolver = (
  clientX: number,
  clientY: number,
) => EditorResolvedPosition | null;

export interface EditorViewLayout {
  segments: ViewLineSegment[];
  modelLineStartViewLines: number[];
  modelLineViewLineCounts: number[];
  totalViewLines: number;
  totalHeight: number;
  getModelLineViewLineCount: (modelLine: number) => number;
  getSegmentForModelPosition: (modelLine: number, column: number) => ViewLineSegment;
  modelPositionToViewPosition: (modelLine: number, column: number) => ViewPosition;
  editorPointToModelPosition: (x: number, y: number) => ViewPosition;
  viewLineToSegment: (viewLine: number) => ViewLineSegment;
}

export interface BuildEditorViewLayoutOptions {
  lines: string[];
  lineHeight: number;
  wordWrap: boolean;
  contentWidth: number;
  measureText: (text: string) => number;
}

const MIN_WRAP_WIDTH = 1;
const WRAP_BREAK_PATTERN = /\s/;

function getAvailableTextWidth(contentWidth: number): number {
  return Math.max(
    MIN_WRAP_WIDTH,
    contentWidth - EDITOR_CONSTANTS.EDITOR_PADDING_LEFT - EDITOR_CONSTANTS.EDITOR_PADDING_RIGHT,
  );
}

function appendSegment(
  segments: ViewLineSegment[],
  modelLine: number,
  startColumn: number,
  endColumn: number,
  lineHeight: number,
) {
  const viewLine = segments.length;
  segments.push({
    viewLine,
    modelLine,
    startColumn,
    endColumn,
    top: viewLine * lineHeight + EDITOR_CONSTANTS.EDITOR_PADDING_TOP,
    height: lineHeight,
  });
}

function buildWrappedSegments(
  line: string,
  modelLine: number,
  lineHeight: number,
  availableTextWidth: number,
  measureText: (text: string) => number,
  segments: ViewLineSegment[],
) {
  if (line.length === 0) {
    appendSegment(segments, modelLine, 0, 0, lineHeight);
    return;
  }

  let segmentStart = 0;
  let column = 0;

  while (column < line.length) {
    let segmentText = "";
    let lastSoftBreakColumn = -1;
    let brokeLine = false;

    for (; column < line.length; column++) {
      const char = line[column];
      const candidate = segmentText + char;

      if (WRAP_BREAK_PATTERN.test(char)) {
        lastSoftBreakColumn = column + 1;
      }

      if (segmentText.length > 0 && measureText(candidate) > availableTextWidth) {
        if (lastSoftBreakColumn > segmentStart) {
          appendSegment(segments, modelLine, segmentStart, lastSoftBreakColumn, lineHeight);
          segmentStart = lastSoftBreakColumn;
          column = lastSoftBreakColumn;
        } else {
          appendSegment(segments, modelLine, segmentStart, column, lineHeight);
          segmentStart = column;
        }
        brokeLine = true;
        break;
      }

      segmentText = candidate;
    }

    if (!brokeLine) {
      break;
    }
  }

  if (segmentStart < line.length) {
    appendSegment(segments, modelLine, segmentStart, line.length, lineHeight);
  }

  if (segments[segments.length - 1]?.modelLine !== modelLine) {
    appendSegment(segments, modelLine, line.length, line.length, lineHeight);
  }
}

function findSegmentForModelPosition(
  segments: ViewLineSegment[],
  modelLineStartViewLines: number[],
  modelLineViewLineCounts: number[],
  modelLine: number,
  column: number,
): ViewLineSegment {
  const lineStartViewLine = modelLineStartViewLines[modelLine] ?? 0;
  const lineViewLineCount = modelLineViewLineCounts[modelLine] ?? 1;
  const firstSegment = segments[lineStartViewLine] ?? segments[0];

  if (!firstSegment) {
    throw new Error("Editor view layout has no segments");
  }

  const clampedColumn = Math.max(0, column);
  const lastViewLine = lineStartViewLine + lineViewLineCount - 1;

  for (let viewLine = lineStartViewLine; viewLine <= lastViewLine; viewLine++) {
    const segment = segments[viewLine];
    if (!segment) break;
    const isLastSegmentForLine = viewLine === lastViewLine;
    if (
      clampedColumn >= segment.startColumn &&
      (clampedColumn < segment.endColumn || isLastSegmentForLine)
    ) {
      return segment;
    }
  }

  return segments[lastViewLine] ?? firstSegment;
}

function findColumnForSegmentX(
  lineText: string,
  segment: ViewLineSegment,
  x: number,
  measureText: (text: string) => number,
): number {
  const localX = Math.max(0, x - EDITOR_CONSTANTS.EDITOR_PADDING_LEFT);
  let bestColumn = segment.startColumn;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let column = segment.startColumn; column <= segment.endColumn; column++) {
    const textBeforeColumn = lineText.slice(segment.startColumn, column);
    const columnX = measureText(textBeforeColumn);
    const distance = Math.abs(columnX - localX);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestColumn = column;
    }
  }

  return bestColumn;
}

export function buildEditorViewLayout({
  lines,
  lineHeight,
  wordWrap,
  contentWidth,
  measureText,
}: BuildEditorViewLayoutOptions): EditorViewLayout {
  const segments: ViewLineSegment[] = [];
  const modelLineStartViewLines: number[] = [];
  const modelLineViewLineCounts: number[] = [];
  const availableTextWidth = getAvailableTextWidth(contentWidth);

  const sourceLines = lines.length > 0 ? lines : [""];

  for (let modelLine = 0; modelLine < sourceLines.length; modelLine++) {
    modelLineStartViewLines[modelLine] = segments.length;

    if (wordWrap && contentWidth > 0) {
      buildWrappedSegments(
        sourceLines[modelLine] ?? "",
        modelLine,
        lineHeight,
        availableTextWidth,
        measureText,
        segments,
      );
    } else {
      appendSegment(segments, modelLine, 0, sourceLines[modelLine]?.length ?? 0, lineHeight);
    }

    modelLineViewLineCounts[modelLine] = segments.length - modelLineStartViewLines[modelLine];
  }

  const totalViewLines = segments.length;
  const totalHeight = totalViewLines * lineHeight;

  return {
    segments,
    modelLineStartViewLines,
    modelLineViewLineCounts,
    totalViewLines,
    totalHeight,
    getModelLineViewLineCount: (modelLine) => modelLineViewLineCounts[modelLine] ?? 1,
    getSegmentForModelPosition: (modelLine, column) =>
      findSegmentForModelPosition(
        segments,
        modelLineStartViewLines,
        modelLineViewLineCounts,
        modelLine,
        column,
      ),
    modelPositionToViewPosition: (modelLine, column) => {
      const segment = findSegmentForModelPosition(
        segments,
        modelLineStartViewLines,
        modelLineViewLineCounts,
        modelLine,
        column,
      );
      const clampedColumn = Math.max(segment.startColumn, Math.min(column, segment.endColumn));
      const textBeforeColumn = (sourceLines[modelLine] ?? "").slice(
        segment.startColumn,
        clampedColumn,
      );

      return {
        viewLine: segment.viewLine,
        modelLine,
        column: clampedColumn,
        top: segment.top,
        left: measureText(textBeforeColumn) + EDITOR_CONSTANTS.EDITOR_PADDING_LEFT,
        segment,
      };
    },
    editorPointToModelPosition: (x, y) => {
      const viewLine = Math.floor(
        Math.max(0, y - EDITOR_CONSTANTS.EDITOR_PADDING_TOP) / lineHeight,
      );
      const segment = segments[Math.max(0, Math.min(viewLine, segments.length - 1))] ?? segments[0];

      if (!segment) {
        throw new Error("Editor view layout has no segments");
      }

      const lineText = sourceLines[segment.modelLine] ?? "";
      const column = findColumnForSegmentX(lineText, segment, x, measureText);
      const viewPosition = {
        viewLine: segment.viewLine,
        modelLine: segment.modelLine,
        column,
        top: segment.top,
        left:
          measureText(lineText.slice(segment.startColumn, column)) +
          EDITOR_CONSTANTS.EDITOR_PADDING_LEFT,
        segment,
      };

      return viewPosition;
    },
    viewLineToSegment: (viewLine) =>
      segments[Math.max(0, Math.min(viewLine, segments.length - 1))] ?? segments[0],
  };
}
