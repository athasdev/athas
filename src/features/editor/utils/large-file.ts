export const LARGE_FILE_TOKENIZATION_SIZE_THRESHOLD = 20 * 1024 * 1024;
export const LARGE_FILE_TOKENIZATION_LINE_THRESHOLD = 300_000;
export const RESPONSIVE_LARGE_FILE_SIZE_THRESHOLD = 2 * 1024 * 1024;
export const RESPONSIVE_LARGE_FILE_LINE_THRESHOLD = 50_000;

export interface LargeFileCheck {
  contentLength: number;
  lineCount?: number;
}

export interface LargeEditorModeInfo {
  lineCount: number;
  largeContentMode: boolean;
  lineOffsets?: number[];
}

export interface LargeContentPosition {
  line: number;
  column: number;
  offset: number;
}

export type MeasureLargeContentText = (text: string) => number;

const INCREMENTAL_LARGE_FILE_INFO_EDIT_THRESHOLD = 1000;

function findCommonPrefixLength(a: string, b: string): number {
  const minLength = Math.min(a.length, b.length);
  let index = 0;
  while (index < minLength && a[index] === b[index]) {
    index++;
  }
  return index;
}

function findCommonSuffixLength(a: string, b: string, prefixLength: number): number {
  const maxSuffixLength = Math.min(a.length - prefixLength, b.length - prefixLength);
  let suffixLength = 0;

  while (
    suffixLength < maxSuffixLength &&
    a[a.length - 1 - suffixLength] === b[b.length - 1 - suffixLength]
  ) {
    suffixLength++;
  }

  return suffixLength;
}

function countNewlines(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) === 10) count++;
  }
  return count;
}

function findLineIndexForOffset(lineOffsets: readonly number[], offset: number): number {
  if (lineOffsets.length === 0) return 0;

  let low = 0;
  let high = lineOffsets.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const lineStart = lineOffsets[mid] ?? 0;
    const nextLineStart = lineOffsets[mid + 1] ?? Number.POSITIVE_INFINITY;

    if (offset < lineStart) {
      high = mid - 1;
    } else if (offset >= nextLineStart) {
      low = mid + 1;
    } else {
      return mid;
    }
  }

  return Math.max(0, Math.min(high, lineOffsets.length - 1));
}

function findFirstLineStartAfterOffset(lineOffsets: readonly number[], offset: number): number {
  let low = 0;
  let high = lineOffsets.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if ((lineOffsets[mid] ?? 0) <= offset) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

function updateLineOffsetsForEdit(
  previousLineOffsets: readonly number[],
  editStartOffset: number,
  previousEditEndOffset: number,
  insertedText: string,
  lengthDelta: number,
): number[] {
  const startLine = findLineIndexForOffset(previousLineOffsets, editStartOffset);
  const appendStartLine = findFirstLineStartAfterOffset(previousLineOffsets, previousEditEndOffset);
  const nextLineOffsets = previousLineOffsets.slice(0, startLine + 1);

  for (let index = 0; index < insertedText.length; index++) {
    if (insertedText.charCodeAt(index) === 10) {
      nextLineOffsets.push(editStartOffset + index + 1);
    }
  }

  for (let index = appendStartLine; index < previousLineOffsets.length; index++) {
    nextLineOffsets.push((previousLineOffsets[index] ?? 0) + lengthDelta);
  }

  return nextLineOffsets;
}

export function isTooLargeForEditorServices({ contentLength, lineCount }: LargeFileCheck): boolean {
  if (contentLength > LARGE_FILE_TOKENIZATION_SIZE_THRESHOLD) return true;
  if (lineCount != null && lineCount > LARGE_FILE_TOKENIZATION_LINE_THRESHOLD) return true;

  if (contentLength >= RESPONSIVE_LARGE_FILE_SIZE_THRESHOLD) return true;
  if (lineCount != null && lineCount >= RESPONSIVE_LARGE_FILE_LINE_THRESHOLD) return true;

  return false;
}

export function shouldUseLargeEditorMode(content: string): boolean {
  if (content.length >= RESPONSIVE_LARGE_FILE_SIZE_THRESHOLD) return true;

  let lineCount = 1;
  for (let index = 0; index < content.length; index++) {
    if (content.charCodeAt(index) === 10) {
      lineCount++;
      if (lineCount >= RESPONSIVE_LARGE_FILE_LINE_THRESHOLD) return true;
    }
  }

  return false;
}

export function getLargeEditorModeInfo(content: string): LargeEditorModeInfo {
  if (content.length === 0) {
    return { lineCount: 1, largeContentMode: false };
  }

  let lineCount = 1;
  let crossedResponsiveLineThreshold = false;
  let lineOffsets: number[] | undefined;

  for (let index = 0; index < content.length; index++) {
    if (content.charCodeAt(index) !== 10) continue;
    lineCount++;

    if (lineCount >= RESPONSIVE_LARGE_FILE_LINE_THRESHOLD) {
      crossedResponsiveLineThreshold = true;
      if (lineOffsets) {
        lineOffsets.push(index + 1);
      } else {
        lineOffsets = collectLineOffsets(content, index + 1);
      }
    } else if (lineOffsets) {
      lineOffsets.push(index + 1);
    }
  }

  const largeContentMode =
    content.length >= RESPONSIVE_LARGE_FILE_SIZE_THRESHOLD ||
    crossedResponsiveLineThreshold ||
    isTooLargeForEditorServices({ contentLength: content.length, lineCount });

  if (largeContentMode && !lineOffsets) {
    lineOffsets = buildLineOffsets(content);
  }

  return {
    lineCount,
    largeContentMode,
    lineOffsets,
  };
}

export function applyIncrementalLargeEditorModeInfo(
  previousContent: string,
  nextContent: string,
  previousInfo: LargeEditorModeInfo,
): LargeEditorModeInfo | null {
  if (previousContent === nextContent) {
    return previousInfo;
  }

  const prefixLength = findCommonPrefixLength(previousContent, nextContent);
  const suffixLength = findCommonSuffixLength(previousContent, nextContent, prefixLength);
  const previousEndOffset = previousContent.length - suffixLength;
  const nextEndOffset = nextContent.length - suffixLength;
  const removedLength = previousEndOffset - prefixLength;
  const insertedLength = nextEndOffset - prefixLength;

  if (
    removedLength < 0 ||
    insertedLength < 0 ||
    Math.max(removedLength, insertedLength) > INCREMENTAL_LARGE_FILE_INFO_EDIT_THRESHOLD
  ) {
    return null;
  }

  const insertedText = nextContent.slice(prefixLength, nextEndOffset);
  const removedNewlines = countNewlines(previousContent.slice(prefixLength, previousEndOffset));
  const insertedNewlines = countNewlines(insertedText);
  const lineCount = Math.max(1, previousInfo.lineCount + insertedNewlines - removedNewlines);
  const largeContentMode =
    previousInfo.largeContentMode ||
    isTooLargeForEditorServices({
      contentLength: nextContent.length,
      lineCount,
    });
  let lineOffsets: number[] | undefined;

  if (largeContentMode) {
    if (previousInfo.lineOffsets) {
      lineOffsets = updateLineOffsetsForEdit(
        previousInfo.lineOffsets,
        prefixLength,
        previousEndOffset,
        insertedText,
        nextContent.length - previousContent.length,
      );
      if (lineOffsets.length !== lineCount) {
        return null;
      }
    } else {
      lineOffsets = buildLineOffsets(nextContent);
    }
  }

  return {
    lineCount,
    largeContentMode,
    lineOffsets,
  };
}

export function buildLineOffsets(content: string): number[] {
  const lineOffsets = [0];
  for (let index = 0; index < content.length; index++) {
    if (content.charCodeAt(index) === 10) {
      lineOffsets.push(index + 1);
    }
  }
  return lineOffsets;
}

function collectLineOffsets(content: string, nextKnownLineOffset: number): number[] {
  const lineOffsets = [0];
  for (let index = 0; index < nextKnownLineOffset - 1; index++) {
    if (content.charCodeAt(index) === 10) {
      lineOffsets.push(index + 1);
    }
  }
  lineOffsets.push(nextKnownLineOffset);
  return lineOffsets;
}

export function countLines(content: string): number {
  if (content.length === 0) return 1;

  let lineCount = 1;
  for (let index = 0; index < content.length; index++) {
    if (content.charCodeAt(index) === 10) lineCount++;
  }

  return lineCount;
}

export function createSparseLineArray(lineCount: number): string[] {
  const lines: string[] = [];
  lines.length = Math.max(0, lineCount);
  return lines;
}

export function getLineOffset(content: string, lineIndex: number): number {
  if (lineIndex <= 0) return 0;

  let currentLine = 0;
  for (let index = 0; index < content.length; index++) {
    if (content.charCodeAt(index) !== 10) continue;
    currentLine++;
    if (currentLine === lineIndex) return index + 1;
  }

  return content.length;
}

export function getLineSlice(content: string, lineIndex: number): { line: string; offset: number } {
  const targetLine = Math.max(0, lineIndex);

  let currentLine = 0;
  let lineStart = 0;

  const buildResult = (lineEnd: number) => {
    const end =
      lineEnd > lineStart && content.charCodeAt(lineEnd - 1) === 13 ? lineEnd - 1 : lineEnd;
    return {
      line: content.slice(lineStart, end),
      offset: lineStart,
    };
  };

  for (let index = 0; index < content.length; index++) {
    if (content.charCodeAt(index) !== 10) continue;

    if (currentLine === targetLine) {
      return buildResult(index);
    }

    currentLine++;
    lineStart = index + 1;
  }

  if (currentLine === targetLine) {
    return buildResult(content.length);
  }

  return {
    line: "",
    offset: content.length,
  };
}

export function sliceContentLines(
  content: string,
  startLine: number,
  endLine: number,
): { lines: string[]; offsets: number[] } {
  const clampedStart = Math.max(0, startLine);
  const clampedEnd = Math.max(clampedStart, endLine);
  const lines: string[] = [];
  const offsets: number[] = [];

  let currentLine = 0;
  let lineStart = 0;

  const pushLine = (lineEnd: number) => {
    if (currentLine >= clampedStart && currentLine < clampedEnd) {
      const end =
        lineEnd > lineStart && content.charCodeAt(lineEnd - 1) === 13 ? lineEnd - 1 : lineEnd;
      lines.push(content.slice(lineStart, end));
      offsets.push(lineStart);
    }
  };

  for (let index = 0; index < content.length; index++) {
    if (content.charCodeAt(index) !== 10) continue;

    pushLine(index);
    currentLine++;
    lineStart = index + 1;

    if (currentLine >= clampedEnd) {
      return { lines, offsets };
    }
  }

  pushLine(content.length);

  return { lines, offsets };
}

export function sliceContentLinesByOffsets(
  content: string,
  lineOffsets: readonly number[],
  startLine: number,
  endLine: number,
): { lines: string[]; offsets: number[] } {
  const clampedStart = Math.max(0, Math.min(startLine, lineOffsets.length));
  const clampedEnd = Math.max(clampedStart, Math.min(endLine, lineOffsets.length));
  const lines: string[] = [];
  const offsets: number[] = [];

  for (let lineIndex = clampedStart; lineIndex < clampedEnd; lineIndex++) {
    const lineStart = lineOffsets[lineIndex] ?? content.length;
    const nextLineStart = lineOffsets[lineIndex + 1] ?? content.length;
    let lineEnd = nextLineStart;

    if (lineEnd > lineStart && content.charCodeAt(lineEnd - 1) === 10) {
      lineEnd--;
    }
    if (lineEnd > lineStart && content.charCodeAt(lineEnd - 1) === 13) {
      lineEnd--;
    }

    lines.push(content.slice(lineStart, lineEnd));
    offsets.push(lineStart);
  }

  return { lines, offsets };
}

export function calculatePositionFromLineOffsets(
  content: string,
  lineOffsets: readonly number[],
  offset: number,
): LargeContentPosition {
  const clampedOffset = Math.max(0, Math.min(offset, content.length));
  if (lineOffsets.length === 0) {
    return { line: 0, column: clampedOffset, offset: clampedOffset };
  }

  let low = 0;
  let high = lineOffsets.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const lineStart = lineOffsets[mid] ?? 0;
    const nextLineStart = lineOffsets[mid + 1] ?? Number.POSITIVE_INFINITY;

    if (clampedOffset < lineStart) {
      high = mid - 1;
    } else if (clampedOffset >= nextLineStart) {
      low = mid + 1;
    } else {
      return {
        line: mid,
        column: clampedOffset - lineStart,
        offset: clampedOffset,
      };
    }
  }

  const line = Math.max(0, Math.min(high, lineOffsets.length - 1));
  return {
    line,
    column: clampedOffset - (lineOffsets[line] ?? 0),
    offset: clampedOffset,
  };
}

export function getLargeContentLineText(
  content: string,
  lineOffsets: readonly number[],
  lineIndex: number,
): string {
  if (lineOffsets.length === 0) return "";

  const clampedLine = Math.max(0, Math.min(lineIndex, lineOffsets.length - 1));
  const lineStart = lineOffsets[clampedLine] ?? content.length;
  const nextLineStart = lineOffsets[clampedLine + 1] ?? content.length;
  let lineEnd = nextLineStart;

  if (lineEnd > lineStart && content.charCodeAt(lineEnd - 1) === 10) lineEnd--;
  if (lineEnd > lineStart && content.charCodeAt(lineEnd - 1) === 13) lineEnd--;

  return content.slice(lineStart, lineEnd);
}

export function getLargeContentOffsetAtPosition(
  content: string,
  lineOffsets: readonly number[],
  line: number,
  column: number,
): number {
  if (lineOffsets.length === 0) return 0;

  const clampedLine = Math.max(0, Math.min(line, lineOffsets.length - 1));
  const lineText = getLargeContentLineText(content, lineOffsets, clampedLine);
  const clampedColumn = Math.max(0, Math.min(column, lineText.length));

  return (lineOffsets[clampedLine] ?? 0) + clampedColumn;
}

export function getLargeContentColumnForX(
  lineText: string,
  x: number,
  measureText: MeasureLargeContentText,
): number {
  if (lineText.length === 0 || x <= 0) return 0;

  let low = 0;
  let high = lineText.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const width = measureText(lineText.slice(0, mid));
    if (width <= x) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  const currentWidth = measureText(lineText.slice(0, low));
  const nextWidth = low < lineText.length ? measureText(lineText.slice(0, low + 1)) : currentWidth;

  return nextWidth - x < x - currentWidth ? Math.min(lineText.length, low + 1) : low;
}
