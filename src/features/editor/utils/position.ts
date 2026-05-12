import { EDITOR_CONSTANTS } from "../config/constants";
import type { Position } from "../types/editor";

/**
 * Calculate cursor position from character offset
 */
export const calculateCursorPosition = (offset: number, lines: string[]): Position => {
  let currentOffset = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineLength = lines[i].length + (i < lines.length - 1 ? 1 : 0); // +1 for newline
    if (currentOffset + lineLength > offset) {
      // Calculate column, but ensure it doesn't exceed the actual line content length
      const column = Math.min(offset - currentOffset, lines[i].length);
      return {
        line: i,
        column,
        offset,
      };
    }
    currentOffset += lineLength;
  }

  return {
    line: lines.length - 1,
    column: lines[lines.length - 1].length,
    offset: lines.reduce(
      (sum, line, idx) => sum + line.length + (idx < lines.length - 1 ? 1 : 0),
      0,
    ),
  };
};

export const calculateCursorPositionFromContent = (offset: number, content: string): Position => {
  const clampedOffset = Math.max(0, Math.min(offset, content.length));
  let line = 0;
  let searchFrom = 0;

  while (searchFrom < clampedOffset) {
    const newlineIndex = content.indexOf("\n", searchFrom);
    if (newlineIndex === -1 || newlineIndex >= clampedOffset) break;
    line++;
    searchFrom = newlineIndex + 1;
  }

  return {
    line,
    column: clampedOffset - searchFrom,
    offset: clampedOffset,
  };
};

export function findLineIndexForOffset(lineOffsets: readonly number[], offset: number): number {
  if (lineOffsets.length === 0) return 0;

  let low = 0;
  let high = lineOffsets.length - 1;
  let line = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const lineOffset = lineOffsets[mid] ?? 0;

    if (lineOffset <= offset) {
      line = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return line;
}

export function calculateLineColumnFromOffsets(
  offset: number,
  lineOffsets: readonly number[],
  contentLength: number,
): { line: number; column: number } {
  const clampedOffset = Math.max(0, Math.min(offset, contentLength));
  const line = findLineIndexForOffset(lineOffsets, clampedOffset);
  const lineStartOffset = lineOffsets[line] ?? 0;

  return {
    line,
    column: Math.max(0, clampedOffset - lineStartOffset),
  };
}

export const calculateCursorPositionFromLineOffsets = (
  offset: number,
  lines: string[],
  lineOffsets: number[],
): Position => {
  const maxOffset =
    lineOffsets.length > 0
      ? (lineOffsets[lineOffsets.length - 1] ?? 0) + (lines[lines.length - 1]?.length ?? 0)
      : 0;
  const clampedOffset = Math.max(0, Math.min(offset, maxOffset));

  const line = findLineIndexForOffset(lineOffsets, clampedOffset);

  const lineText = lines[line] ?? "";
  const lineStartOffset = lineOffsets[line] ?? 0;

  return {
    line,
    column: Math.max(0, Math.min(clampedOffset - lineStartOffset, lineText.length)),
    offset: clampedOffset,
  };
};

/**
 * Calculate character offset from line and column position
 */
export const calculateOffsetFromPosition = (
  line: number,
  column: number,
  lines: string[],
): number => {
  let offset = 0;

  // Add lengths of all lines before the target line
  for (let i = 0; i < line && i < lines.length; i++) {
    offset += lines[i].length + 1; // +1 for newline
  }

  // Add the column position within the target line
  if (line < lines.length) {
    offset += Math.min(column, lines[line].length);
  }

  return offset;
};

export const calculateOffsetFromContentPosition = (
  content: string,
  line: number,
  column: number,
): number => {
  if (line <= 0) {
    return Math.max(0, Math.min(column, content.length));
  }

  let currentLine = 0;
  let lineStartOffset = 0;

  for (let index = 0; index < content.length; index++) {
    if (content.charCodeAt(index) !== 10) continue;

    currentLine++;
    lineStartOffset = index + 1;

    if (currentLine === line) {
      const nextNewline = content.indexOf("\n", lineStartOffset);
      const lineEndOffset = nextNewline === -1 ? content.length : nextNewline;
      return lineStartOffset + Math.max(0, Math.min(column, lineEndOffset - lineStartOffset));
    }
  }

  return content.length;
};

export const getLineTextFromContent = (content: string, line: number): string => {
  const lineStartOffset = calculateOffsetFromContentPosition(content, line, 0);
  if (lineStartOffset >= content.length) return "";

  const lineEndOffset = content.indexOf("\n", lineStartOffset);
  const end = lineEndOffset === -1 ? content.length : lineEndOffset;
  const normalizedEnd = end > lineStartOffset && content.charCodeAt(end - 1) === 13 ? end - 1 : end;
  return content.slice(lineStartOffset, normalizedEnd);
};

export const getLineTextsFromContent = (
  content: string,
  lineNumbers: Iterable<number>,
): Map<number, string> => {
  const targetLines = Array.from(
    new Set(
      Array.from(lineNumbers)
        .filter((line) => Number.isFinite(line))
        .map((line) => Math.trunc(line))
        .filter((line) => line >= 0),
    ),
  ).sort((a, b) => a - b);
  const result = new Map<number, string>();
  if (targetLines.length === 0) return result;

  let targetIndex = 0;
  let currentLine = 0;
  let lineStart = 0;

  const pushLine = (lineEnd: number) => {
    if (currentLine !== targetLines[targetIndex]) return;

    const normalizedEnd =
      lineEnd > lineStart && content.charCodeAt(lineEnd - 1) === 13 ? lineEnd - 1 : lineEnd;
    result.set(currentLine, content.slice(lineStart, normalizedEnd));

    while (targetLines[targetIndex] === currentLine) {
      targetIndex++;
    }
  };

  for (let index = 0; index < content.length && targetIndex < targetLines.length; index++) {
    if (content.charCodeAt(index) !== 10) continue;

    pushLine(index);
    currentLine++;
    lineStart = index + 1;
  }

  if (targetIndex < targetLines.length) {
    pushLine(content.length);
  }

  return result;
};

/**
 * Get line height based on font size
 */
export const getLineHeight = (
  fontSize: number,
  lineHeight: number = EDITOR_CONSTANTS.LINE_HEIGHT_MULTIPLIER,
): number => {
  // Fractional line-height causes subpixel misalignment between textarea and rendered lines
  return Math.ceil(fontSize * lineHeight);
};

/**
 * Character width cache to avoid repeated measurements
 */
const charWidthCache = new Map<string, number>();
const prewarmedFontConfigs = new Set<string>();

/**
 * Canvas context for measuring text (reused to avoid creating multiple contexts)
 */
let measureContext: CanvasRenderingContext2D | null = null;

/**
 * Get or create the measurement canvas context
 */
const getMeasureContext = (): CanvasRenderingContext2D => {
  if (!measureContext) {
    const measureCanvas = document.createElement("canvas");
    measureContext = measureCanvas.getContext("2d", {
      // Performance optimization: we don't need alpha channel for text measurement
      alpha: false,
    })!;
  }
  return measureContext;
};

/**
 * Pre-warm cache with common characters for better initial performance
 */
const prewarmCharCache = (fontSize: number, fontFamily: string) => {
  const commonChars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 !@#$%^&*()_+-=[]{}|;:',.<>?/`~";
  const ctx = getMeasureContext();
  ctx.font = `${fontSize}px ${fontFamily}`;

  for (const char of commonChars) {
    const cacheKey = `${char}-${fontSize}-${fontFamily}`;
    if (!charWidthCache.has(cacheKey)) {
      const width = ctx.measureText(char).width;
      const roundedWidth =
        Math.round(width * EDITOR_CONSTANTS.WIDTH_PRECISION_MULTIPLIER) /
        EDITOR_CONSTANTS.WIDTH_PRECISION_MULTIPLIER;
      charWidthCache.set(cacheKey, roundedWidth);
    }
  }
};

/**
 * Get accurate character width from cache or measure using canvas (much faster than DOM)
 */
export const getCharWidthCached = (
  char: string,
  fontSize: number,
  fontFamily: string = 'JetBrains Mono, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
): number => {
  const fontKey = `${fontSize}-${fontFamily}`;
  const cacheKey = `${char}-${fontKey}`;

  if (charWidthCache.has(cacheKey)) {
    return charWidthCache.get(cacheKey)!;
  }

  // Use canvas measureText for fast, non-blocking measurement
  const ctx = getMeasureContext();
  ctx.font = `${fontSize}px ${fontFamily}`;

  const width = ctx.measureText(char).width;
  const roundedWidth =
    Math.round(width * EDITOR_CONSTANTS.WIDTH_PRECISION_MULTIPLIER) /
    EDITOR_CONSTANTS.WIDTH_PRECISION_MULTIPLIER;

  charWidthCache.set(cacheKey, roundedWidth);

  // Prewarm cache once per font configuration.
  if (!prewarmedFontConfigs.has(fontKey)) {
    prewarmedFontConfigs.add(fontKey);
    // Use requestIdleCallback if available, otherwise setTimeout
    const scheduleIdle =
      typeof requestIdleCallback === "function"
        ? requestIdleCallback
        : (fn: () => void) => setTimeout(fn, 1);
    scheduleIdle(() => prewarmCharCache(fontSize, fontFamily));
  }

  return roundedWidth;
};

/**
 * Get accurate X position for a cursor at given line and column
 * This accounts for variable-width characters, tabs, etc.
 */
export const getAccurateCursorX = (
  line: string,
  column: number,
  fontSize: number,
  fontFamily: string = 'JetBrains Mono, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  tabSize: number = 2,
): number => {
  let x = 0;
  const limitedColumn = Math.min(column, line.length);

  for (let i = 0; i < limitedColumn; i++) {
    const char = line[i];
    if (char === "\t") {
      // Calculate tab width based on current position and tab size
      const spacesUntilNextTab = tabSize - (i % tabSize);
      x += getCharWidthCached(" ", fontSize, fontFamily) * spacesUntilNextTab;
    } else {
      x += getCharWidthCached(char, fontSize, fontFamily);
    }
  }

  return x;
};

export const measureTextWidth = (
  text: string,
  fontSize: number,
  fontFamily: string = 'JetBrains Mono, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  tabSize: number = 2,
): number => getAccurateCursorX(text, text.length, fontSize, fontFamily, tabSize);

/**
 * Clear character width cache (useful when font changes)
 */
export const clearCharWidthCache = () => {
  charWidthCache.clear();
  prewarmedFontConfigs.clear();
};
