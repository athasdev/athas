/**
 * Word-based motions (w, b, e, W, B, E)
 */

import type { Position } from "@/types/editor-types";
import type { Motion, VimRange } from "../core/types";

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
 * Motion: w - word forward
 */
export const wordForward: Motion = {
  name: "w",
  calculate: (cursor: Position, lines: string[], count = 1): VimRange => {
    const content = lines.join("\n");
    let offset = cursor.offset;

    for (let i = 0; i < count; i++) {
      // Skip current word
      while (offset < content.length && /\w/.test(content[offset])) {
        offset++;
      }
      // Skip whitespace
      while (offset < content.length && /\s/.test(content[offset])) {
        offset++;
      }
    }

    const endPos = offsetToPosition(Math.min(offset, content.length), lines);

    return {
      start: cursor,
      end: endPos,
      inclusive: false,
    };
  },
};

/**
 * Motion: b - word backward
 */
export const wordBackward: Motion = {
  name: "b",
  calculate: (cursor: Position, lines: string[], count = 1): VimRange => {
    const content = lines.join("\n");
    let offset = cursor.offset;

    for (let i = 0; i < count; i++) {
      if (offset > 0) {
        offset--;
        // Skip whitespace
        while (offset > 0 && /\s/.test(content[offset])) {
          offset--;
        }
        // Skip current word
        while (offset > 0 && /\w/.test(content[offset - 1])) {
          offset--;
        }
      }
    }

    const startPos = offsetToPosition(Math.max(0, offset), lines);

    return {
      start: startPos,
      end: cursor,
      inclusive: false,
    };
  },
};

/**
 * Motion: e - end of word
 */
export const wordEnd: Motion = {
  name: "e",
  calculate: (cursor: Position, lines: string[], count = 1): VimRange => {
    const content = lines.join("\n");
    let offset = cursor.offset;

    for (let i = 0; i < count; i++) {
      // Move to next character if we're at the end of a word
      if (offset < content.length && /\w/.test(content[offset])) {
        offset++;
      }

      // Skip whitespace and non-word characters
      while (offset < content.length && !/\w/.test(content[offset])) {
        offset++;
      }

      // Move to end of word
      while (offset < content.length && /\w/.test(content[offset])) {
        offset++;
      }

      // Back up one to be on the last character
      if (offset > 0) offset--;
    }

    const endPos = offsetToPosition(Math.min(offset, content.length - 1), lines);

    return {
      start: cursor,
      end: endPos,
      inclusive: true,
    };
  },
};

/**
 * Motion: W - WORD forward (whitespace-separated)
 */
export const WORDForward: Motion = {
  name: "W",
  calculate: (cursor: Position, lines: string[], count = 1): VimRange => {
    const content = lines.join("\n");
    let offset = cursor.offset;

    for (let i = 0; i < count; i++) {
      // Skip current WORD (non-whitespace)
      while (offset < content.length && /\S/.test(content[offset])) {
        offset++;
      }
      // Skip whitespace
      while (offset < content.length && /\s/.test(content[offset])) {
        offset++;
      }
    }

    const endPos = offsetToPosition(Math.min(offset, content.length), lines);

    return {
      start: cursor,
      end: endPos,
      inclusive: false,
    };
  },
};

/**
 * Motion: B - WORD backward (whitespace-separated)
 */
export const WORDBackward: Motion = {
  name: "B",
  calculate: (cursor: Position, lines: string[], count = 1): VimRange => {
    const content = lines.join("\n");
    let offset = cursor.offset;

    for (let i = 0; i < count; i++) {
      if (offset > 0) {
        offset--;
        // Skip whitespace
        while (offset > 0 && /\s/.test(content[offset])) {
          offset--;
        }
        // Skip current WORD
        while (offset > 0 && /\S/.test(content[offset - 1])) {
          offset--;
        }
      }
    }

    const startPos = offsetToPosition(Math.max(0, offset), lines);

    return {
      start: startPos,
      end: cursor,
      inclusive: false,
    };
  },
};

/**
 * Motion: E - end of WORD (whitespace-separated)
 */
export const WORDEnd: Motion = {
  name: "E",
  calculate: (cursor: Position, lines: string[], count = 1): VimRange => {
    const content = lines.join("\n");
    let offset = cursor.offset;

    for (let i = 0; i < count; i++) {
      // Move to next character if we're at the end of a WORD
      if (offset < content.length && /\S/.test(content[offset])) {
        offset++;
      }

      // Skip whitespace
      while (offset < content.length && /\s/.test(content[offset])) {
        offset++;
      }

      // Move to end of WORD
      while (offset < content.length && /\S/.test(content[offset])) {
        offset++;
      }

      // Back up one to be on the last character
      if (offset > 0) offset--;
    }

    const endPos = offsetToPosition(Math.min(offset, content.length - 1), lines);

    return {
      start: cursor,
      end: endPos,
      inclusive: true,
    };
  },
};
