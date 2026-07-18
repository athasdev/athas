import { EDITOR_CONSTANTS } from "../config/constants";

export interface ViewLineSegment {
  viewLine: number;
  modelLine: number;
  startColumn: number;
  endColumn: number;
  top: number;
  height: number;
}

export interface EditorViewZone {
  id: string;
  afterLine: number;
  height: number;
}

export interface ResolvedEditorViewZone extends EditorViewZone {
  top: number;
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

export type EditorModelPositionResolver = (
  line: number,
  column: number,
) => EditorResolvedPosition | null;

export interface EditorViewLayout {
  segments: ViewLineSegment[];
  zones: ResolvedEditorViewZone[];
  modelLineStartViewLines: number[];
  modelLineViewLineCounts: number[];
  totalViewLines: number;
  totalHeight: number;
  totalZoneHeight: number;
  getModelLineViewLineCount: (modelLine: number) => number;
  getSegmentForModelPosition: (modelLine: number, column: number) => ViewLineSegment;
  modelPositionToViewPosition: (modelLine: number, column: number) => ViewPosition;
  editorPointToModelPosition: (x: number, y: number) => ViewPosition;
  viewLineToSegment: (viewLine: number) => ViewLineSegment;
}

export interface BuildEditorViewLayoutOptions {
  lines: string[];
  lineCount?: number;
  lineHeight: number;
  wordWrap: boolean;
  contentWidth: number;
  measureText: (text: string) => number;
  zones?: EditorViewZone[];
  compact?: boolean;
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

export function getViewZoneHeightBeforeLine(
  zones: ReadonlyArray<Pick<ResolvedEditorViewZone, "afterLine" | "height">>,
  modelLine: number,
): number {
  let height = 0;
  for (const zone of zones) {
    if (zone.afterLine < modelLine) {
      height += zone.height;
    }
  }
  return height;
}

function resolveZones(
  zones: EditorViewZone[],
  segments: ViewLineSegment[],
  lineHeight: number,
): ResolvedEditorViewZone[] {
  let cumulativeZoneHeight = 0;
  return [...zones]
    .filter((zone) => zone.height > 0)
    .sort((a, b) => a.afterLine - b.afterLine || a.id.localeCompare(b.id))
    .map((zone) => {
      const anchorLine = Math.max(0, Math.min(zone.afterLine, segments.length - 1));
      let anchorSegment: ViewLineSegment | undefined;
      for (let index = segments.length - 1; index >= 0; index--) {
        if (segments[index].modelLine === anchorLine) {
          anchorSegment = segments[index];
          break;
        }
      }
      const fallbackTop =
        EDITOR_CONSTANTS.EDITOR_PADDING_TOP + Math.max(0, zone.afterLine + 1) * lineHeight;
      const top =
        (anchorSegment ? anchorSegment.top + anchorSegment.height : fallbackTop) +
        cumulativeZoneHeight;
      cumulativeZoneHeight += zone.height;
      return { ...zone, top };
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
  if (segment.endColumn <= segment.startColumn || localX <= 0) {
    return segment.startColumn;
  }

  let low = segment.startColumn;
  let high = segment.endColumn;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const width = measureText(lineText.slice(segment.startColumn, mid));
    if (width <= localX) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  const currentWidth = measureText(lineText.slice(segment.startColumn, low));
  const nextWidth =
    low < segment.endColumn
      ? measureText(lineText.slice(segment.startColumn, low + 1))
      : currentWidth;

  return nextWidth - localX < localX - currentWidth ? Math.min(segment.endColumn, low + 1) : low;
}

export function buildEditorViewLayout({
  lines,
  lineCount,
  lineHeight,
  wordWrap,
  contentWidth,
  measureText,
  zones = [],
  compact = false,
}: BuildEditorViewLayoutOptions): EditorViewLayout {
  const sourceLines = lines.length > 0 ? lines : [""];
  const sourceLineCount = Math.max(1, lineCount ?? sourceLines.length);

  if (compact && !wordWrap && zones.length === 0) {
    const totalViewLines = sourceLineCount;
    const totalHeight = totalViewLines * lineHeight;
    const createSegment = (modelLine: number): ViewLineSegment => {
      const clampedModelLine = Math.max(0, Math.min(modelLine, sourceLineCount - 1));
      return {
        viewLine: clampedModelLine,
        modelLine: clampedModelLine,
        startColumn: 0,
        endColumn: sourceLines[clampedModelLine]?.length ?? 0,
        top: clampedModelLine * lineHeight + EDITOR_CONSTANTS.EDITOR_PADDING_TOP,
        height: lineHeight,
      };
    };

    return {
      segments: [],
      zones: [],
      modelLineStartViewLines: [],
      modelLineViewLineCounts: [],
      totalViewLines,
      totalHeight,
      totalZoneHeight: 0,
      getModelLineViewLineCount: () => 1,
      getSegmentForModelPosition: (modelLine) => createSegment(modelLine),
      modelPositionToViewPosition: (modelLine, column) => {
        const segment = createSegment(modelLine);
        const clampedColumn = Math.max(0, Math.min(column, segment.endColumn));
        const textBeforeColumn = (sourceLines[segment.modelLine] ?? "").slice(0, clampedColumn);

        return {
          viewLine: segment.viewLine,
          modelLine: segment.modelLine,
          column: clampedColumn,
          top: segment.top,
          left: measureText(textBeforeColumn) + EDITOR_CONSTANTS.EDITOR_PADDING_LEFT,
          segment,
        };
      },
      editorPointToModelPosition: (x, y) => {
        const modelLine = Math.floor(
          Math.max(0, y - EDITOR_CONSTANTS.EDITOR_PADDING_TOP) / lineHeight,
        );
        const segment = createSegment(modelLine);
        const lineText = sourceLines[segment.modelLine] ?? "";
        const column = findColumnForSegmentX(lineText, segment, x, measureText);

        return {
          viewLine: segment.viewLine,
          modelLine: segment.modelLine,
          column,
          top: segment.top,
          left:
            measureText(lineText.slice(segment.startColumn, column)) +
            EDITOR_CONSTANTS.EDITOR_PADDING_LEFT,
          segment,
        };
      },
      viewLineToSegment: (viewLine) => createSegment(viewLine),
    };
  }

  const segments: ViewLineSegment[] = [];
  const modelLineStartViewLines: number[] = [];
  const modelLineViewLineCounts: number[] = [];
  const availableTextWidth = getAvailableTextWidth(contentWidth);

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
  const resolvedZones = resolveZones(zones, segments, lineHeight);
  const totalZoneHeight = resolvedZones.reduce((total, zone) => total + zone.height, 0);

  for (const segment of segments) {
    segment.top += getViewZoneHeightBeforeLine(resolvedZones, segment.modelLine);
  }

  const totalHeight = totalViewLines * lineHeight + totalZoneHeight;

  return {
    segments,
    zones: resolvedZones,
    modelLineStartViewLines,
    modelLineViewLineCounts,
    totalViewLines,
    totalHeight,
    totalZoneHeight,
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
      const adjustedY =
        y -
        resolvedZones.reduce((height, zone) => (y >= zone.top ? height + zone.height : height), 0);
      const viewLine = Math.floor(
        Math.max(0, adjustedY - EDITOR_CONSTANTS.EDITOR_PADDING_TOP) / lineHeight,
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
