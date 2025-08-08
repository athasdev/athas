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

  // Round to avoid subpixel issues
  return Math.round(width * 100) / 100;
};
