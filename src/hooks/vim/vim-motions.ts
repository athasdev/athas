import type { VimMotion } from "./vim-types";

// Utility functions for text navigation
export const findNextWordStart = (text: string, start: number): number => {
  const afterCursor = text.slice(start);
  const wordMatch = afterCursor.match(/\W*\w/);
  if (wordMatch) {
    return start + wordMatch.index! + wordMatch[0].length - 1;
  }
  return text.length;
};

export const findEndOfWord = (text: string, start: number): number => {
  const afterCursor = text.slice(start);
  const wordMatch = afterCursor.match(/\w*\W/);
  if (wordMatch) {
    return start + wordMatch.index! + wordMatch[0].length - 2;
  }
  const endMatch = afterCursor.match(/\w+$/);
  if (endMatch) {
    return start + endMatch.index! + endMatch[0].length - 1;
  }
  return Math.max(start, text.length - 1);
};

export const findPrevWord = (text: string, start: number): number => {
  const beforeCursor = text.slice(0, start);
  const matches = [...beforeCursor.matchAll(/\w+/g)];
  if (matches.length > 0) {
    const lastMatch = matches[matches.length - 1];
    return lastMatch.index!;
  }
  return 0;
};

export const findCharInLine = (
  text: string,
  start: number,
  char: string,
  direction: "forward" | "backward" = "forward",
): number => {
  const lines = text.split("\n");
  const currentLineIndex = text.substring(0, start).split("\n").length - 1;
  const currentLine = lines[currentLineIndex];
  const lineStart = text.substring(0, start).lastIndexOf("\n") + 1;
  const posInLine = start - lineStart;

  if (direction === "forward") {
    const searchFrom = posInLine + 1;
    const foundIndex = currentLine.indexOf(char, searchFrom);
    if (foundIndex !== -1) {
      return lineStart + foundIndex;
    }
  } else {
    const searchTo = posInLine;
    const foundIndex = currentLine.lastIndexOf(char, searchTo - 1);
    if (foundIndex !== -1) {
      return lineStart + foundIndex;
    }
  }
  return start;
};

export const getLineStartPosition = (text: string, cursorPos: number): number => {
  return text.substring(0, cursorPos).lastIndexOf("\n") + 1;
};

export const getLineEndPosition = (text: string, cursorPos: number): number => {
  const lineEnd = text.indexOf("\n", cursorPos);
  return lineEnd === -1 ? text.length : lineEnd;
};

export const getCurrentLineIndex = (text: string, cursorPos: number): number => {
  return text.substring(0, cursorPos).split("\n").length - 1;
};

export const getColumnIndex = (text: string, cursorPos: number): number => {
  return cursorPos - text.substring(0, cursorPos).lastIndexOf("\n") - 1;
};

// Basic movement motions
export const motions: VimMotion[] = [
  {
    key: "h",
    execute: context => Math.max(0, context.cursorPosition - 1),
    description: "Move cursor left",
  },
  {
    key: "l",
    execute: context => Math.min(context.content.length, context.cursorPosition + 1),
    description: "Move cursor right",
  },
  {
    key: "j",
    execute: context => {
      const lines = context.content.split("\n");
      const currentLineIndex = getCurrentLineIndex(context.content, context.cursorPosition);
      const columnIndex = getColumnIndex(context.content, context.cursorPosition);

      if (currentLineIndex < lines.length - 1) {
        const nextLine = lines[currentLineIndex + 1];
        const nextLineStart = context.content.indexOf("\n", context.cursorPosition) + 1;
        return Math.min(nextLineStart + columnIndex, nextLineStart + nextLine.length);
      }
      return context.cursorPosition;
    },
    description: "Move cursor down",
  },
  {
    key: "k",
    execute: context => {
      const lines = context.content.split("\n");
      const currentLineIndex = getCurrentLineIndex(context.content, context.cursorPosition);
      const columnIndex = getColumnIndex(context.content, context.cursorPosition);

      if (currentLineIndex > 0) {
        const prevLine = lines[currentLineIndex - 1];
        const currentLineStart = getLineStartPosition(context.content, context.cursorPosition);
        const prevLineStart = context.content.substring(0, currentLineStart).lastIndexOf("\n") + 1;
        return Math.min(prevLineStart + columnIndex, prevLineStart + prevLine.length);
      }
      return context.cursorPosition;
    },
    description: "Move cursor up",
  },
  {
    key: "w",
    execute: context => findNextWordStart(context.content, context.cursorPosition + 1),
    description: "Move to next word start",
  },
  {
    key: "W",
    execute: context => {
      const nextBigWordMatch = context.content.slice(context.cursorPosition).match(/\s+\S/);
      if (nextBigWordMatch) {
        return context.cursorPosition + nextBigWordMatch.index! + nextBigWordMatch[0].length - 1;
      }
      return context.cursorPosition;
    },
    description: "Move to next WORD start",
  },
  {
    key: "e",
    execute: context => findEndOfWord(context.content, context.cursorPosition + 1),
    description: "Move to end of word",
  },
  {
    key: "E",
    execute: context => {
      const endBigWordMatch = context.content.slice(context.cursorPosition).match(/\S+/);
      if (endBigWordMatch) {
        return context.cursorPosition + endBigWordMatch.index! + endBigWordMatch[0].length - 1;
      }
      return context.cursorPosition;
    },
    description: "Move to end of WORD",
  },
  {
    key: "b",
    execute: context => findPrevWord(context.content, context.cursorPosition),
    description: "Move to previous word start",
  },
  {
    key: "B",
    execute: context => {
      const beforeCursor = context.content.slice(0, context.cursorPosition);
      const prevBigWordMatch = beforeCursor.match(/\S+\s*$/);
      if (prevBigWordMatch) {
        return context.cursorPosition - prevBigWordMatch[0].length;
      }
      return context.cursorPosition;
    },
    description: "Move to previous WORD start",
  },
  {
    key: "0",
    execute: context => getLineStartPosition(context.content, context.cursorPosition),
    description: "Move to beginning of line",
  },
  {
    key: "^",
    execute: context => {
      const lineStart = getLineStartPosition(context.content, context.cursorPosition);
      const currentLine = context.content.slice(lineStart).split("\n")[0];
      const firstNonBlankMatch = currentLine.match(/\S/);
      return firstNonBlankMatch ? lineStart + firstNonBlankMatch.index! : lineStart;
    },
    description: "Move to first non-blank character of line",
  },
  {
    key: "$",
    execute: context => getLineEndPosition(context.content, context.cursorPosition),
    description: "Move to end of line",
  },
  {
    key: "G",
    execute: context => context.content.length,
    description: "Move to end of file",
  },
  {
    key: "gg",
    execute: () => 0,
    description: "Move to beginning of file",
  },
];
