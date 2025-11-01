import { EDITOR_CONSTANTS } from "../constants/editor-constants";
import type { Position } from "../types/editor-types";

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
  fontFamily: string = "JetBrains Mono, monospace",
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

  // Keep full precision to avoid cumulative drift on long lines
  return width;
};

/**
 * Character width cache to avoid repeated DOM measurements
 */
const charWidthCache = new Map<string, number>();

interface ScrollbarSize {
  width: number;
  height: number;
}

let scrollbarSizeCache: ScrollbarSize | null = null;

/**
 * Get accurate character width from cache or measure
 */
export const getCharWidthCached = (
  char: string,
  fontSize: number,
  fontFamily: string = "JetBrains Mono, monospace",
): number => {
  const cacheKey = `${char}-${fontSize}-${fontFamily}`;

  if (charWidthCache.has(cacheKey)) {
    return charWidthCache.get(cacheKey)!;
  }

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

  measureElement.textContent = char;

  document.body.appendChild(measureElement);
  const width = measureElement.getBoundingClientRect().width;
  document.body.removeChild(measureElement);

  // Cache full precision so downstream consumers stay in sync with rendered text
  charWidthCache.set(cacheKey, width);

  return width;
};

interface MeasurementContext {
  element: HTMLSpanElement;
  container: HTMLElement;
  fontSize: number;
  fontFamily: string;
  tabSize: number;
}

let measurementContext: MeasurementContext | null = null;

const ensureMeasurementContext = (
  fontSize: number,
  fontFamily: string,
  tabSize: number,
): MeasurementContext => {
  const effectiveTabSize =
    Number.isFinite(tabSize) && tabSize > 0 ? Math.max(1, Math.round(tabSize)) : 2;

  const needsNewContext =
    !measurementContext ||
    measurementContext.fontSize !== fontSize ||
    measurementContext.fontFamily !== fontFamily ||
    measurementContext.tabSize !== effectiveTabSize ||
    !document.body.contains(measurementContext.element);

  if (!needsNewContext) {
    return measurementContext!;
  }

  if (measurementContext && measurementContext.element.parentNode) {
    measurementContext.element.parentNode.removeChild(measurementContext.element);
  }

  const element = document.createElement("span");
  element.setAttribute("data-editor-measurement", "true");
  element.style.position = "absolute";
  element.style.visibility = "hidden";
  element.style.whiteSpace = "pre";
  element.style.pointerEvents = "none";
  element.style.padding = "0";
  element.style.margin = "0";
  element.style.border = "none";
  element.style.lineHeight = "1";
  element.style.left = "0";
  element.style.top = "0";
  element.style.transform = "translate(-9999px, -9999px)";
  element.style.fontFamily = fontFamily;
  element.style.fontSize = `${fontSize}px`;
  element.style.setProperty("tab-size", String(effectiveTabSize));
  // Some browsers still expect the camelCase property
  (element.style as unknown as { tabSize?: string }).tabSize = String(effectiveTabSize);

  const container =
    (document.querySelector(".editor-container") as HTMLElement | null) ||
    document.body ||
    document.documentElement;

  container.appendChild(element);

  measurementContext = {
    element,
    container,
    fontSize,
    fontFamily,
    tabSize: effectiveTabSize,
  };

  return measurementContext;
};

/**
 * Get accurate X position for a cursor at given line and column
 * This accounts for variable-width characters, tabs, and zoom/transform effects.
 */
export const getAccurateCursorX = (
  line: string,
  column: number,
  fontSize: number,
  fontFamily: string = "JetBrains Mono, monospace",
  tabSize: number = 2,
): number => {
  const limitedColumn = Math.max(0, Math.min(column, line.length));
  if (limitedColumn === 0) {
    return 0;
  }

  const context = ensureMeasurementContext(fontSize, fontFamily, tabSize);
  if (!context) {
    return limitedColumn * fontSize * EDITOR_CONSTANTS.CHAR_WIDTH_MULTIPLIER;
  }

  const { element } = context;

  // Slice up to the column so we measure the exact rendered width of the substring
  const substring = line.slice(0, limitedColumn);
  element.textContent = substring || "";

  const width = element.getBoundingClientRect().width;

  return width;
};

/**
 * Calculate rendered width of an entire line in pixels.
 * Uses cached character measurements to avoid unnecessary reflow.
 */
export const getLineRenderWidth = (
  line: string,
  fontSize: number,
  fontFamily: string = "JetBrains Mono, monospace",
  tabSize: number = 2,
): number => {
  if (!line) {
    return 0;
  }

  const effectiveTabSize =
    Number.isFinite(tabSize) && tabSize > 0 ? Math.max(1, Math.round(tabSize)) : 2;
  const spaceWidth = getCharWidthCached(" ", fontSize, fontFamily);

  let width = 0;
  let visualColumn = 0;

  for (const char of line) {
    if (char === "\t") {
      const remainder = visualColumn % effectiveTabSize;
      const spacesUntilNextTab = remainder === 0 ? effectiveTabSize : effectiveTabSize - remainder;
      width += spaceWidth * spacesUntilNextTab;
      visualColumn += spacesUntilNextTab;
      continue;
    }

    const charWidth = getCharWidthCached(char, fontSize, fontFamily);
    width += charWidth;

    const approximateColumns = Math.max(1, Math.round(charWidth / spaceWidth));
    visualColumn += approximateColumns;
  }

  return width;
};

/**
 * Clear character width cache (useful when font changes)
 */
export const clearCharWidthCache = () => {
  charWidthCache.clear();
  if (measurementContext?.element.parentNode) {
    measurementContext.element.parentNode.removeChild(measurementContext.element);
  }
  measurementContext = null;
};

const computeScrollbarSize = (): ScrollbarSize => {
  if (typeof document === "undefined") {
    return { width: 0, height: 0 };
  }

  const outer = document.createElement("div");
  outer.style.visibility = "hidden";
  outer.style.position = "absolute";
  outer.style.top = "-9999px";
  outer.style.width = "100px";
  outer.style.height = "100px";
  outer.style.overflow = "scroll";

  const inner = document.createElement("div");
  inner.style.width = "100%";
  inner.style.height = "100%";

  outer.appendChild(inner);
  document.body.appendChild(outer);

  const vertical = outer.offsetWidth - outer.clientWidth;
  const horizontal = outer.offsetHeight - outer.clientHeight;

  document.body.removeChild(outer);

  return {
    width: vertical > 0 ? vertical : 0,
    height: horizontal > 0 ? horizontal : 0,
  };
};

export const getScrollbarSize = (scale: number = 1): ScrollbarSize => {
  if (!scrollbarSizeCache) {
    scrollbarSizeCache = computeScrollbarSize();
  }

  const normalizedScale = Number.isFinite(scale) && scale > 0 ? scale : 1;

  return {
    width: scrollbarSizeCache.width * normalizedScale,
    height: scrollbarSizeCache.height * normalizedScale,
  };
};

export const clearScrollbarSizeCache = () => {
  scrollbarSizeCache = null;
};
