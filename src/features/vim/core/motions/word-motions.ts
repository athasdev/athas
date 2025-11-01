/**
 * Word-based motions (w, b, e, W, B, E)
 *
 * This implementation follows proper Vim semantics:
 * - w/b/e: "word" = alphanumeric + underscore, punctuation treated as separate words
 * - W/B/E: "WORD" = any non-whitespace sequence
 */

import type { Position } from "@/features/editor/types/editor";
import { calculateCursorPosition } from "@/features/editor/utils/position";
import type { Motion, VimRange } from "../core/types";

/**
 * Helper to calculate position from line and column
 */
const positionFromLineColumn = (line: number, column: number, lines: string[]): Position => {
  let offset = 0;
  for (let i = 0; i < line && i < lines.length; i++) {
    offset += lines[i].length + 1; // +1 for newline
  }
  offset += column;

  return {
    line,
    column,
    offset,
  };
};

/**
 * Character classification for vim word semantics
 */
const isWordChar = (char: string): boolean => /[a-zA-Z0-9_]/.test(char);
const isPunctuation = (char: string): boolean => /[^\sa-zA-Z0-9_]/.test(char);
const isWhitespace = (char: string): boolean => /\s/.test(char);

/**
 * Motion: w - word forward
 * Moves to the beginning of the next word
 */
export const wordForward: Motion = {
  name: "w",
  calculate: (cursor: Position, lines: string[], count = 1): VimRange => {
    let currentLine = cursor.line;
    let currentCol = cursor.column;

    for (let i = 0; i < count; i++) {
      // If we're at the end of the document, stay there
      if (currentLine >= lines.length) {
        break;
      }

      let line = lines[currentLine];

      // If current position is beyond line length, move to next line
      if (currentCol >= line.length) {
        currentLine++;
        currentCol = 0;

        // Skip empty lines and find first non-whitespace character
        while (
          currentLine < lines.length &&
          (lines[currentLine].length === 0 || /^\s*$/.test(lines[currentLine]))
        ) {
          currentLine++;
        }

        if (currentLine < lines.length) {
          currentCol = 0;
          // Find first non-whitespace character
          while (
            currentCol < lines[currentLine].length &&
            isWhitespace(lines[currentLine][currentCol])
          ) {
            currentCol++;
          }
        }
        continue;
      }

      const currentChar = line[currentCol];

      if (isWordChar(currentChar)) {
        // In a word - skip to end of current word
        while (currentCol < line.length && isWordChar(line[currentCol])) {
          currentCol++;
        }
      } else if (isPunctuation(currentChar)) {
        // In punctuation - skip current punctuation sequence
        while (currentCol < line.length && isPunctuation(line[currentCol])) {
          currentCol++;
        }
      }

      // Skip whitespace to find beginning of next word
      while (currentLine < lines.length) {
        line = lines[currentLine];

        while (currentCol < line.length && isWhitespace(line[currentCol])) {
          currentCol++;
        }

        if (currentCol < line.length) {
          // Found non-whitespace character
          break;
        }

        // End of line, move to next
        currentLine++;
        currentCol = 0;
      }
    }

    // Ensure we don't go past the end of the document
    if (currentLine >= lines.length) {
      currentLine = lines.length - 1;
      currentCol = lines[currentLine]?.length || 0;
    } else if (currentCol >= lines[currentLine].length) {
      currentCol = Math.max(0, lines[currentLine].length - 1);
    }

    const endPos = positionFromLineColumn(currentLine, currentCol, lines);

    return {
      start: cursor,
      end: endPos,
      inclusive: false,
    };
  },
};

/**
 * Motion: b - word backward
 * Moves to the beginning of the previous word
 */
export const wordBackward: Motion = {
  name: "b",
  calculate: (cursor: Position, lines: string[], count = 1): VimRange => {
    let currentLine = cursor.line;
    let currentCol = cursor.column;

    for (let i = 0; i < count; i++) {
      // If we're at the beginning of the document, stay there
      if (currentLine === 0 && currentCol === 0) {
        break;
      }

      let found = false;

      // Go backwards until we find a word beginning
      while (!found && (currentLine > 0 || currentCol > 0)) {
        // Move back one position
        if (currentCol > 0) {
          currentCol--;
        } else {
          // Move to end of previous line
          currentLine--;
          if (currentLine >= 0) {
            currentCol = Math.max(0, lines[currentLine].length - 1);
          }
        }

        if (currentLine < 0) {
          currentLine = 0;
          currentCol = 0;
          break;
        }

        const line = lines[currentLine];
        if (currentCol >= line.length) continue;

        const char = line[currentCol];

        // Check if this is a word beginning
        if (isWordChar(char) || isPunctuation(char)) {
          // We're on a non-whitespace character
          // Check if the previous character is different type or whitespace
          if (currentCol === 0) {
            // Beginning of line is always word beginning
            found = true;
          } else {
            const prevChar = line[currentCol - 1];
            if (isWhitespace(prevChar)) {
              // Previous char is whitespace, so this is word beginning
              found = true;
            } else if (isWordChar(char) && !isWordChar(prevChar)) {
              // Transition from punctuation to word
              found = true;
            } else if (isPunctuation(char) && !isPunctuation(prevChar)) {
              // Transition from word to punctuation
              found = true;
            }
          }
        }
      }
    }

    // Ensure bounds
    if (currentLine < 0) {
      currentLine = 0;
      currentCol = 0;
    }

    const targetPos = positionFromLineColumn(currentLine, currentCol, lines);

    return {
      start: cursor,
      end: targetPos,
      inclusive: false,
    };
  },
};

/**
 * Motion: e - end of word
 * Moves to the end of the current/next word
 */
export const wordEnd: Motion = {
  name: "e",
  calculate: (cursor: Position, lines: string[], count = 1): VimRange => {
    let currentLine = cursor.line;
    let currentCol = cursor.column;

    for (let i = 0; i < count; i++) {
      if (currentLine >= lines.length) {
        break;
      }

      let line = lines[currentLine];

      // If we're at end of line, move to next line
      if (currentCol >= line.length) {
        currentLine++;
        if (currentLine >= lines.length) {
          break;
        }
        currentCol = 0;
        line = lines[currentLine];
      }

      const currentChar = line[currentCol];

      // If we're in the middle of a word/punctuation, find its end
      if (isWordChar(currentChar)) {
        // Skip to end of current word, then back up one
        while (currentCol + 1 < line.length && isWordChar(line[currentCol + 1])) {
          currentCol++;
        }
      } else if (isPunctuation(currentChar)) {
        // Skip to end of current punctuation sequence, then back up one
        while (currentCol + 1 < line.length && isPunctuation(line[currentCol + 1])) {
          currentCol++;
        }
      } else {
        // We're in whitespace, find next word/punctuation
        // Skip whitespace to find next word
        while (currentLine < lines.length) {
          line = lines[currentLine];

          while (currentCol < line.length && isWhitespace(line[currentCol])) {
            currentCol++;
          }

          if (currentCol < line.length) {
            // Found non-whitespace, now find end
            const char = line[currentCol];
            if (isWordChar(char)) {
              while (currentCol + 1 < line.length && isWordChar(line[currentCol + 1])) {
                currentCol++;
              }
            } else if (isPunctuation(char)) {
              while (currentCol + 1 < line.length && isPunctuation(line[currentCol + 1])) {
                currentCol++;
              }
            }
            break;
          }

          // End of line, move to next
          currentLine++;
          currentCol = 0;
        }
      }
    }

    // Ensure we don't go past the end
    if (currentLine >= lines.length) {
      currentLine = lines.length - 1;
      currentCol = Math.max(0, lines[currentLine].length - 1);
    } else if (currentCol >= lines[currentLine].length) {
      currentCol = Math.max(0, lines[currentLine].length - 1);
    }

    const endPos = positionFromLineColumn(currentLine, currentCol, lines);

    return {
      start: cursor,
      end: endPos,
      inclusive: true,
    };
  },
};

/**
 * Motion: ge - previous end of word
 * Moves to the end of the previous word (word semantics)
 */
const classifyChar = (char: string): "word" | "punct" | "other" | "whitespace" => {
  if (isWhitespace(char)) return "whitespace";
  if (isWordChar(char)) return "word";
  if (isPunctuation(char)) return "punct";
  return "other";
};

const isSameClass = (a: string, targetType: "word" | "punct" | "other"): boolean => {
  if (targetType === "word") return isWordChar(a);
  if (targetType === "punct") return isPunctuation(a);
  return !isWhitespace(a) && !isWordChar(a) && !isPunctuation(a);
};

export const wordPreviousEnd: Motion = {
  name: "ge",
  calculate: (cursor: Position, lines: string[], count = 1): VimRange => {
    if (lines.length === 0) {
      return { start: cursor, end: cursor, inclusive: true };
    }

    const content = lines.join("\n");
    if (content.length === 0) {
      return { start: cursor, end: cursor, inclusive: true };
    }

    let offset = Math.min(Math.max(cursor.offset, 0), content.length);
    let segmentEnd = offset;

    for (let iteration = 0; iteration < count; iteration++) {
      if (offset === 0) {
        segmentEnd = 0;
        break;
      }

      offset = Math.max(0, offset - 1);

      while (offset > 0 && classifyChar(content[offset]) === "whitespace") {
        offset--;
      }

      if (classifyChar(content[offset]) === "whitespace") {
        segmentEnd = offset;
        break;
      }

      const currentChar = content[offset];
      const charType = classifyChar(currentChar);
      segmentEnd = offset;

      while (offset > 0) {
        const prevChar = content[offset - 1];
        if (classifyChar(prevChar) === "whitespace") {
          break;
        }

        if (!isSameClass(prevChar, charType as "word" | "punct" | "other")) {
          break;
        }

        offset--;
      }
    }

    const targetPosition = calculateCursorPosition(segmentEnd, lines);

    return {
      start: cursor,
      end: targetPosition,
      inclusive: true,
    };
  },
};

/**
 * Motion: W - WORD forward (whitespace-separated)
 * Moves to the beginning of the next WORD (any non-whitespace sequence)
 */
export const WORDForward: Motion = {
  name: "W",
  calculate: (cursor: Position, lines: string[], count = 1): VimRange => {
    let currentLine = cursor.line;
    let currentCol = cursor.column;

    for (let i = 0; i < count; i++) {
      if (currentLine >= lines.length) {
        break;
      }

      let line = lines[currentLine];

      // If current position is beyond line length, move to next line
      if (currentCol >= line.length) {
        currentLine++;
        currentCol = 0;

        // Skip empty lines
        while (
          currentLine < lines.length &&
          (lines[currentLine].length === 0 || /^\s*$/.test(lines[currentLine]))
        ) {
          currentLine++;
        }

        if (currentLine < lines.length) {
          currentCol = 0;
          // Find first non-whitespace character
          while (
            currentCol < lines[currentLine].length &&
            isWhitespace(lines[currentLine][currentCol])
          ) {
            currentCol++;
          }
        }
        continue;
      }

      // Skip current WORD (any non-whitespace)
      while (currentCol < line.length && !isWhitespace(line[currentCol])) {
        currentCol++;
      }

      // Skip whitespace to find beginning of next WORD
      while (currentLine < lines.length) {
        line = lines[currentLine];

        while (currentCol < line.length && isWhitespace(line[currentCol])) {
          currentCol++;
        }

        if (currentCol < line.length) {
          // Found non-whitespace character
          break;
        }

        // End of line, move to next
        currentLine++;
        currentCol = 0;
      }
    }

    // Ensure bounds
    if (currentLine >= lines.length) {
      currentLine = lines.length - 1;
      currentCol = lines[currentLine]?.length || 0;
    } else if (currentCol >= lines[currentLine].length) {
      currentCol = Math.max(0, lines[currentLine].length - 1);
    }

    const endPos = positionFromLineColumn(currentLine, currentCol, lines);

    return {
      start: cursor,
      end: endPos,
      inclusive: false,
    };
  },
};

/**
 * Motion: B - WORD backward (whitespace-separated)
 * Moves to the beginning of the previous WORD
 */
export const WORDBackward: Motion = {
  name: "B",
  calculate: (cursor: Position, lines: string[], count = 1): VimRange => {
    let currentLine = cursor.line;
    let currentCol = cursor.column;

    for (let i = 0; i < count; i++) {
      // If we're at the beginning of the document, stay there
      if (currentLine === 0 && currentCol === 0) {
        break;
      }

      let found = false;

      // Go backwards until we find a WORD beginning
      while (!found && (currentLine > 0 || currentCol > 0)) {
        // Move back one position
        if (currentCol > 0) {
          currentCol--;
        } else {
          // Move to end of previous line
          currentLine--;
          if (currentLine >= 0) {
            currentCol = Math.max(0, lines[currentLine].length - 1);
          }
        }

        if (currentLine < 0) {
          currentLine = 0;
          currentCol = 0;
          break;
        }

        const line = lines[currentLine];
        if (currentCol >= line.length) continue;

        const char = line[currentCol];

        // Check if this is a WORD beginning
        if (!isWhitespace(char)) {
          // We're on a non-whitespace character
          // Check if the previous character is whitespace or we're at line start
          if (currentCol === 0) {
            // Beginning of line is always WORD beginning
            found = true;
          } else {
            const prevChar = line[currentCol - 1];
            if (isWhitespace(prevChar)) {
              // Previous char is whitespace, so this is WORD beginning
              found = true;
            }
          }
        }
      }
    }

    // Ensure bounds
    if (currentLine < 0) {
      currentLine = 0;
      currentCol = 0;
    }

    const targetPos = positionFromLineColumn(currentLine, currentCol, lines);

    return {
      start: cursor,
      end: targetPos,
      inclusive: false,
    };
  },
};

/**
 * Motion: E - end of WORD (whitespace-separated)
 * Moves to the end of the current/next WORD
 */
export const WORDEnd: Motion = {
  name: "E",
  calculate: (cursor: Position, lines: string[], count = 1): VimRange => {
    let currentLine = cursor.line;
    let currentCol = cursor.column;

    for (let i = 0; i < count; i++) {
      if (currentLine >= lines.length) {
        break;
      }

      let line = lines[currentLine];

      // If we're at end of line, move to next line
      if (currentCol >= line.length) {
        currentLine++;
        if (currentLine >= lines.length) {
          break;
        }
        currentCol = 0;
        line = lines[currentLine];
      }

      const currentChar = line[currentCol];

      // If we're in a WORD, find its end
      if (!isWhitespace(currentChar)) {
        // Skip to end of current WORD
        while (currentCol + 1 < line.length && !isWhitespace(line[currentCol + 1])) {
          currentCol++;
        }
      } else {
        // We're in whitespace, find next WORD
        while (currentLine < lines.length) {
          line = lines[currentLine];

          while (currentCol < line.length && isWhitespace(line[currentCol])) {
            currentCol++;
          }

          if (currentCol < line.length) {
            // Found non-whitespace, find end of WORD
            while (currentCol + 1 < line.length && !isWhitespace(line[currentCol + 1])) {
              currentCol++;
            }
            break;
          }

          // End of line, move to next
          currentLine++;
          currentCol = 0;
        }
      }
    }

    // Ensure bounds
    if (currentLine >= lines.length) {
      currentLine = lines.length - 1;
      currentCol = Math.max(0, lines[currentLine].length - 1);
    } else if (currentCol >= lines[currentLine].length) {
      currentCol = Math.max(0, lines[currentLine].length - 1);
    }

    const endPos = positionFromLineColumn(currentLine, currentCol, lines);

    return {
      start: cursor,
      end: endPos,
      inclusive: true,
    };
  },
};
