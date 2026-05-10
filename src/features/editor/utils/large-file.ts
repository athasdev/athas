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

  for (let index = 0; index < content.length; index++) {
    if (content.charCodeAt(index) !== 10) continue;
    lineCount++;
    if (lineCount >= RESPONSIVE_LARGE_FILE_LINE_THRESHOLD) {
      crossedResponsiveLineThreshold = true;
    }
  }

  return {
    lineCount,
    largeContentMode:
      content.length >= RESPONSIVE_LARGE_FILE_SIZE_THRESHOLD ||
      crossedResponsiveLineThreshold ||
      isTooLargeForEditorServices({ contentLength: content.length, lineCount }),
  };
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
