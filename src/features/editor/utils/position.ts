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

/**
 * Get line height based on font size
 */
export const getLineHeight = (fontSize: number): number => {
  // Fractional line-height causes subpixel misalignment between textarea and rendered lines
  return Math.ceil(fontSize * EDITOR_CONSTANTS.LINE_HEIGHT_MULTIPLIER);
};

/**
 * Get character width based on font size using actual DOM measurement
 * This ensures pixel-perfect alignment with the textarea
 */
export const getCharWidth = (
  fontSize: number,
  fontFamily: string = 'JetBrains Mono, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
): number => {
  // Create a temporary element to measure character width
  const measureElement = document.createElement("span");
  measureElement.style.position = "absolute";
  measureElement.style.visibility = "hidden";
  measureElement.style.whiteSpace = "pre";
  measureElement.style.fontSize = `${fontSize}px`;
  measureElement.style.fontFamily = fontFamily;
  measureElement.style.lineHeight = "1";
  measureElement.style.padding = "0";
  measureElement.style.margin = "0";
  measureElement.style.border = "none";

  measureElement.textContent = "M";

  document.body.appendChild(measureElement);
  const width = measureElement.getBoundingClientRect().width;
  document.body.removeChild(measureElement);

  // Round to avoid subpixel issues
  return (
    Math.round(width * EDITOR_CONSTANTS.WIDTH_PRECISION_MULTIPLIER) /
    EDITOR_CONSTANTS.WIDTH_PRECISION_MULTIPLIER
  );
};

/**
 * Character width cache to avoid repeated measurements
 */
const charWidthCache = new Map<string, number>();

/**
 * Canvas context for measuring text (reused to avoid creating multiple contexts)
 */
let measureCanvas: HTMLCanvasElement | null = null;
let measureContext: CanvasRenderingContext2D | null = null;

/**
 * Get or create the measurement canvas context
 */
const getMeasureContext = (): CanvasRenderingContext2D => {
  if (!measureContext) {
    measureCanvas = document.createElement("canvas");
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
  const cacheKey = `${char}-${fontSize}-${fontFamily}`;

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

  // Prewarm cache on first use for this font configuration
  if (charWidthCache.size < 100) {
    requestIdleCallback(() => prewarmCharCache(fontSize, fontFamily));
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

/**
 * Clear character width cache (useful when font changes)
 */
export const clearCharWidthCache = () => {
  charWidthCache.clear();
};
