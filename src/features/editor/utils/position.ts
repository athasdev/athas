import { EDITOR_CONSTANTS } from "../config/constants";
import type { Position } from "../types/editor";

export const EDITOR_FONT_METRICS_READY_EVENT = "athas:editor-font-metrics-ready";

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
let pendingFontReadyCacheClear = false;

/**
 * Canvas context for measuring text (reused to avoid creating multiple contexts)
 */
let measureContext: CanvasRenderingContext2D | null = null;
let renderedMeasureElement: HTMLSpanElement | null = null;

const GENERIC_FONT_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "emoji",
  "math",
  "fangsong",
]);

function quoteFontFamilyName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) return trimmed;
  if (GENERIC_FONT_FAMILIES.has(trimmed.toLowerCase())) return trimmed;
  if (/^[a-zA-Z_][\w-]*$/.test(trimmed)) return trimmed;

  return `"${trimmed.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function normalizeCanvasFontFamily(fontFamily: string): string {
  return fontFamily.split(",").map(quoteFontFamilyName).filter(Boolean).join(", ");
}

function buildCanvasFont(fontSize: number, fontFamily: string): string {
  return `${fontSize}px ${normalizeCanvasFontFamily(fontFamily)}`;
}

function isCanvasFontReady(font: string): boolean {
  if (typeof document === "undefined" || !("fonts" in document)) return true;

  return document.fonts.check(font);
}

function clearCacheWhenFontsReady() {
  if (pendingFontReadyCacheClear) return;
  if (typeof document === "undefined" || !("fonts" in document)) return;

  pendingFontReadyCacheClear = true;
  void document.fonts.ready.then(() => {
    pendingFontReadyCacheClear = false;
    clearCharWidthCache();
    window.dispatchEvent(new Event(EDITOR_FONT_METRICS_READY_EVENT));
  });
}

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
  const font = buildCanvasFont(fontSize, fontFamily);
  if (!isCanvasFontReady(font)) {
    clearCacheWhenFontsReady();
    return;
  }
  ctx.font = font;

  for (const char of commonChars) {
    const cacheKey = `${char}-${font}`;
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
  const font = buildCanvasFont(fontSize, fontFamily);
  const fontReady = isCanvasFontReady(font);
  if (!fontReady) {
    clearCacheWhenFontsReady();
  }

  const fontKey = font;
  const cacheKey = `${char}-${fontKey}`;

  if (fontReady && charWidthCache.has(cacheKey)) {
    return charWidthCache.get(cacheKey)!;
  }

  if (typeof document === "undefined") {
    return Math.round(fontSize * EDITOR_CONSTANTS.CHAR_WIDTH_MULTIPLIER * 100) / 100;
  }

  // Use canvas measureText for fast, non-blocking measurement
  const ctx = getMeasureContext();
  ctx.font = font;

  const width = ctx.measureText(char).width;
  const roundedWidth =
    Math.round(width * EDITOR_CONSTANTS.WIDTH_PRECISION_MULTIPLIER) /
    EDITOR_CONSTANTS.WIDTH_PRECISION_MULTIPLIER;

  if (fontReady) {
    charWidthCache.set(cacheKey, roundedWidth);
  }

  // Prewarm cache once per font configuration.
  if (fontReady && !prewarmedFontConfigs.has(fontKey)) {
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
  let visualColumn = 0;
  const safeTabSize = Math.max(1, Math.trunc(tabSize));
  const limitedColumn = Math.min(column, line.length);

  for (let i = 0; i < limitedColumn; i++) {
    const char = line[i];
    if (char === "\t") {
      const tabRemainder = visualColumn % safeTabSize;
      const spacesUntilNextTab = tabRemainder === 0 ? safeTabSize : safeTabSize - tabRemainder;
      x += getCharWidthCached(" ", fontSize, fontFamily) * spacesUntilNextTab;
      visualColumn += spacesUntilNextTab;
    } else {
      x += getCharWidthCached(char, fontSize, fontFamily);
      visualColumn++;
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

function getRenderedMeasureElement(): HTMLSpanElement | null {
  if (typeof document === "undefined") return null;

  if (renderedMeasureElement?.isConnected) {
    return renderedMeasureElement;
  }

  const element = document.createElement("span");
  element.setAttribute("aria-hidden", "true");
  element.style.position = "absolute";
  element.style.visibility = "hidden";
  element.style.pointerEvents = "none";
  element.style.whiteSpace = "pre";
  element.style.left = "-10000px";
  element.style.top = "-10000px";
  element.style.fontKerning = "none";
  element.style.fontVariantLigatures = "none";
  element.style.fontFeatureSettings = '"liga" 0, "calt" 0, "tnum" 1';
  element.style.letterSpacing = "0";
  element.style.textRendering = "optimizeSpeed";
  document.body.appendChild(element);
  renderedMeasureElement = element;
  return element;
}

export const measureRenderedTextWidth = (
  text: string,
  fontSize: number,
  fontFamily: string = 'JetBrains Mono, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  tabSize: number = 2,
): number => {
  const element = getRenderedMeasureElement();
  if (!element) return measureTextWidth(text, fontSize, fontFamily, tabSize);

  element.style.fontSize = `${fontSize}px`;
  element.style.fontFamily = fontFamily;
  element.style.tabSize = `${Math.max(1, Math.trunc(tabSize))}`;
  element.textContent = text;

  const width = element.getBoundingClientRect().width;
  return (
    Math.round(width * EDITOR_CONSTANTS.WIDTH_PRECISION_MULTIPLIER) /
    EDITOR_CONSTANTS.WIDTH_PRECISION_MULTIPLIER
  );
};

/**
 * Clear character width cache (useful when font changes)
 */
export const clearCharWidthCache = () => {
  charWidthCache.clear();
  prewarmedFontConfigs.clear();
};
