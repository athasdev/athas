/**
 * Text objects for vim commands (iw, aw, i", a(, etc.)
 */

import type { Position } from "@/types/editor-types";
import type { TextObject, VimRange } from "./types";

/**
 * Helper to get the full content as a string
 */
const getContentString = (lines: string[]): string => lines.join("\n");

/**
 * Text object: word (w)
 * Matches word characters (letters, numbers, underscore)
 */
export const wordTextObject: TextObject = {
  name: "word",
  calculate: (cursor: Position, lines: string[], mode: "inner" | "around"): VimRange | null => {
    const content = getContentString(lines);
    const offset = cursor.offset;

    // Find word boundaries
    let start = offset;
    let end = offset;

    // Expand backwards to start of word
    while (start > 0 && /\w/.test(content[start - 1])) {
      start--;
    }

    // Expand forwards to end of word
    while (end < content.length && /\w/.test(content[end])) {
      end++;
    }

    // If not on a word, try to find next word
    if (start === end) {
      while (end < content.length && !/\w/.test(content[end])) {
        end++;
      }
      start = end;
      while (end < content.length && /\w/.test(content[end])) {
        end++;
      }
    }

    // For "around" mode, include trailing whitespace
    if (mode === "around") {
      while (end < content.length && /\s/.test(content[end])) {
        end++;
      }
      // If no trailing whitespace, include leading whitespace
      if (end === start + (offset - start)) {
        while (start > 0 && /\s/.test(content[start - 1])) {
          start--;
        }
      }
    }

    if (start === end) return null;

    // Convert offsets to positions
    const startPos = offsetToPosition(start, lines);
    const endPos = offsetToPosition(end, lines);

    return {
      start: startPos,
      end: endPos,
      inclusive: false,
    };
  },
};

/**
 * Text object: WORD (W)
 * Matches non-whitespace sequences
 */
export const WORDTextObject: TextObject = {
  name: "WORD",
  calculate: (cursor: Position, lines: string[], mode: "inner" | "around"): VimRange | null => {
    const content = getContentString(lines);
    const offset = cursor.offset;

    let start = offset;
    let end = offset;

    // Expand backwards to start of WORD
    while (start > 0 && /\S/.test(content[start - 1])) {
      start--;
    }

    // Expand forwards to end of WORD
    while (end < content.length && /\S/.test(content[end])) {
      end++;
    }

    // For "around" mode, include trailing whitespace
    if (mode === "around") {
      while (end < content.length && /\s/.test(content[end])) {
        end++;
      }
    }

    if (start === end) return null;

    const startPos = offsetToPosition(start, lines);
    const endPos = offsetToPosition(end, lines);

    return {
      start: startPos,
      end: endPos,
      inclusive: false,
    };
  },
};

/**
 * Create a paired delimiter text object (quotes, brackets, etc.)
 */
const createPairTextObject = (openChar: string, closeChar: string, name: string): TextObject => ({
  name,
  calculate: (cursor: Position, lines: string[], mode: "inner" | "around"): VimRange | null => {
    const content = getContentString(lines);
    const offset = cursor.offset;

    // For quotes (same open and close char), find enclosing pair
    const isSameChar = openChar === closeChar;

    if (isSameChar) {
      // Find the enclosing quotes
      let start = offset - 1;
      let end = offset;
      let foundStart = false;

      // Search backwards for opening quote
      while (start >= 0) {
        if (content[start] === openChar) {
          // Check if it's escaped
          let escapeCount = 0;
          let checkPos = start - 1;
          while (checkPos >= 0 && content[checkPos] === "\\") {
            escapeCount++;
            checkPos--;
          }
          if (escapeCount % 2 === 0) {
            foundStart = true;
            break;
          }
        }
        start--;
      }

      if (!foundStart) return null;

      // Search forwards for closing quote
      end = start + 1;
      while (end < content.length) {
        if (content[end] === closeChar) {
          // Check if it's escaped
          let escapeCount = 0;
          let checkPos = end - 1;
          while (checkPos >= 0 && content[checkPos] === "\\") {
            escapeCount++;
            checkPos--;
          }
          if (escapeCount % 2 === 0) {
            break;
          }
        }
        end++;
      }

      if (end >= content.length) return null;

      // Adjust for inner vs around
      const rangeStart = mode === "inner" ? start + 1 : start;
      const rangeEnd = mode === "inner" ? end : end + 1;

      const startPos = offsetToPosition(rangeStart, lines);
      const endPos = offsetToPosition(rangeEnd, lines);

      return {
        start: startPos,
        end: endPos,
        inclusive: false,
      };
    }

    // For different open/close chars (brackets, parens, etc.)
    let start = offset;
    let end = offset;
    let depth = 0;

    // Search backwards for opening bracket
    while (start >= 0) {
      if (content[start] === closeChar) depth++;
      if (content[start] === openChar) {
        if (depth === 0) break;
        depth--;
      }
      start--;
    }

    if (start < 0) return null;

    // Search forwards for closing bracket
    depth = 0;
    end = start + 1;
    while (end < content.length) {
      if (content[end] === openChar) depth++;
      if (content[end] === closeChar) {
        if (depth === 0) break;
        depth--;
      }
      end++;
    }

    if (end >= content.length) return null;

    // Adjust for inner vs around
    const rangeStart = mode === "inner" ? start + 1 : start;
    const rangeEnd = mode === "inner" ? end : end + 1;

    const startPos = offsetToPosition(rangeStart, lines);
    const endPos = offsetToPosition(rangeEnd, lines);

    return {
      start: startPos,
      end: endPos,
      inclusive: false,
    };
  },
});

/**
 * Helper to convert offset to position
 */
const offsetToPosition = (offset: number, lines: string[]): Position => {
  let currentOffset = 0;
  let line = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineLength = lines[i].length;
    if (currentOffset + lineLength >= offset) {
      line = i;
      break;
    }
    currentOffset += lineLength + 1; // +1 for newline
  }

  const column = offset - currentOffset;
  return {
    line,
    column,
    offset,
  };
};

/**
 * All available text objects
 */
export const textObjects: Record<string, TextObject> = {
  w: wordTextObject,
  W: WORDTextObject,
  '"': createPairTextObject('"', '"', "double-quote"),
  "'": createPairTextObject("'", "'", "single-quote"),
  "`": createPairTextObject("`", "`", "backtick"),
  "(": createPairTextObject("(", ")", "parentheses"),
  ")": createPairTextObject("(", ")", "parentheses"),
  b: createPairTextObject("(", ")", "parentheses"), // 'b' is alias for ()
  "{": createPairTextObject("{", "}", "braces"),
  "}": createPairTextObject("{", "}", "braces"),
  B: createPairTextObject("{", "}", "braces"), // 'B' is alias for {}
  "[": createPairTextObject("[", "]", "brackets"),
  "]": createPairTextObject("[", "]", "brackets"),
  "<": createPairTextObject("<", ">", "angle-brackets"),
  ">": createPairTextObject("<", ">", "angle-brackets"),
  t: createPairTextObject("<", ">", "tag"), // 't' for HTML/XML tags
};

/**
 * Get a text object by key
 */
export const getTextObject = (key: string): TextObject | undefined => {
  return textObjects[key];
};
