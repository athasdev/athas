import isEqual from "fast-deep-equal";
import { createWithEqualityFn } from "zustand/traditional";
import { isEditorContent } from "@/features/panes/types/pane-content";
import { createSelectors } from "@/utils/zustand-selectors";
import type { LineToken } from "../types/editor";
import { createSparseLineArray, getLargeEditorModeInfo } from "../utils/large-file";
import { useBufferStore } from "./buffer-store";

interface EditorViewState {
  // Computed views of the active buffer
  lines: string[];
  lineCount: number;
  lineTokens: Map<number, LineToken[]>;

  // Actions
  actions: {
    getLines: () => string[];
    getLineCount: () => number;
    getLineTokens: () => Map<number, LineToken[]>;
    getContent: () => string;
  };
}

// Helper function to convert buffer tokens to line tokens
// Handles conversion from byte offsets (from tree-sitter) to character positions
function convertToLineTokens(
  content: string,
  tokens: Array<{ start: number; end: number; class_name: string }>,
): Map<number, LineToken[]> {
  const lines = content.split("\n");
  const tokensByLine = new Map<number, LineToken[]>();

  if (tokens.length === 0) {
    return tokensByLine;
  }

  // Build a byte-to-character mapping for proper UTF-8 handling
  const encoder = new TextEncoder();
  let byteOffset = 0;
  let charOffset = 0;
  const byteToChar = new Map<number, number>();

  for (let i = 0; i < content.length; i++) {
    byteToChar.set(byteOffset, charOffset);
    const char = content[i];
    const charBytes = encoder.encode(char).length;
    byteOffset += charBytes;
    charOffset++;
  }
  byteToChar.set(byteOffset, charOffset); // End position

  // Convert byte offsets to character offsets
  const charTokens = tokens
    .map((token) => {
      // Find closest byte positions if exact match not found
      let start = byteToChar.get(token.start);
      let end = byteToChar.get(token.end);

      // If exact byte position not found, find the closest character position
      if (start === undefined) {
        // Find the largest byte offset that's <= token.start
        let closestByte = 0;
        for (const [byte, char] of byteToChar.entries()) {
          if (byte <= token.start && byte > closestByte) {
            closestByte = byte;
            start = char;
          }
        }
        if (start === undefined) start = 0;
      }

      if (end === undefined) {
        // Find the smallest byte offset that's >= token.end
        let closestChar = content.length;
        for (const [byte, char] of byteToChar.entries()) {
          if (byte >= token.end && char < closestChar) {
            closestChar = char;
            end = char;
          }
        }
        if (end === undefined) end = content.length;
      }

      return { start, end, class_name: token.class_name };
    })
    .filter((token) => {
      // Keep tokens that are valid for the current content
      return (
        token.start >= 0 &&
        token.end <= content.length &&
        token.start < token.end &&
        token.end - token.start < 10000 // Allow large tokens but skip absurdly large ones
      );
    });

  let currentCharOffset = 0;

  for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
    const lineLength = lines[lineNumber].length;
    const lineStart = currentCharOffset;
    const lineEnd = currentCharOffset + lineLength;
    const lineTokens: LineToken[] = [];

    // Find tokens that overlap with this line
    for (const token of charTokens) {
      if (token.start >= lineEnd) break;
      if (token.end <= lineStart) continue;

      const tokenStartInLine = Math.max(0, token.start - lineStart);
      const tokenEndInLine = Math.min(lineLength, token.end - lineStart);

      if (tokenStartInLine < tokenEndInLine) {
        lineTokens.push({
          startColumn: tokenStartInLine,
          endColumn: tokenEndInLine,
          className: token.class_name,
        });
      }
    }

    if (lineTokens.length > 0) {
      tokensByLine.set(lineNumber, lineTokens);
    }

    currentCharOffset += lineLength + 1; // +1 for newline
  }

  return tokensByLine;
}

export const useEditorViewStore = createSelectors(
  createWithEqualityFn<EditorViewState>()(
    (_set, _get) => ({
      // These will be computed from the active buffer
      lines: [""],
      lineCount: 1,
      lineTokens: new Map(),

      actions: {
        getLines: () => {
          const activeBuffer = useBufferStore.getState().actions.getActiveBuffer();
          if (!activeBuffer || !isEditorContent(activeBuffer)) return [""];
          const largeEditorInfo = getLargeEditorModeInfo(activeBuffer.content);
          if (largeEditorInfo.largeContentMode) {
            return createSparseLineArray(largeEditorInfo.lineCount);
          }
          return activeBuffer.content.split("\n");
        },

        getLineCount: () => {
          const activeBuffer = useBufferStore.getState().actions.getActiveBuffer();
          if (!activeBuffer || !isEditorContent(activeBuffer)) return 1;
          return getLargeEditorModeInfo(activeBuffer.content).lineCount;
        },

        getLineTokens: () => {
          const activeBuffer = useBufferStore.getState().actions.getActiveBuffer();
          if (!activeBuffer || !isEditorContent(activeBuffer)) return new Map();
          return convertToLineTokens(activeBuffer.content, activeBuffer.tokens);
        },

        getContent: () => {
          const activeBuffer = useBufferStore.getState().actions.getActiveBuffer();
          if (!activeBuffer || !isEditorContent(activeBuffer)) return "";
          return activeBuffer.content;
        },
      },
    }),
    isEqual,
  ),
);

let previousActiveBufferSnapshot: {
  id: string;
  content: string;
  lines: string[];
} | null = null;

const INCREMENTAL_LINE_EDIT_THRESHOLD = 1000;

function isSparseLineArray(lines: string[]): boolean {
  return lines.length > 0 && Object.keys(lines).length === 0;
}

function findCommonPrefixLength(a: string, b: string): number {
  const minLength = Math.min(a.length, b.length);
  let index = 0;
  while (index < minLength && a[index] === b[index]) {
    index++;
  }
  return index;
}

function findCommonSuffixLength(a: string, b: string, prefixLength: number): number {
  const maxSuffixLength = Math.min(a.length - prefixLength, b.length - prefixLength);
  let suffixLength = 0;

  while (
    suffixLength < maxSuffixLength &&
    a[a.length - 1 - suffixLength] === b[b.length - 1 - suffixLength]
  ) {
    suffixLength++;
  }

  return suffixLength;
}

function getLinePositionForOffset(lines: string[], offset: number) {
  let currentOffset = 0;

  for (let line = 0; line < lines.length; line++) {
    const lineLength = lines[line].length;
    const lineEnd = currentOffset + lineLength;

    if (offset <= lineEnd) {
      return { line, column: offset - currentOffset };
    }

    currentOffset = lineEnd + 1;
  }

  const lastLine = Math.max(0, lines.length - 1);
  return { line: lastLine, column: lines[lastLine]?.length ?? 0 };
}

export function applyIncrementalLineEdit(
  previousContent: string,
  nextContent: string,
  previousLines: string[],
): string[] | null {
  if (isSparseLineArray(previousLines)) {
    return null;
  }

  if (previousContent === nextContent) {
    return previousLines;
  }

  const prefixLength = findCommonPrefixLength(previousContent, nextContent);
  const suffixLength = findCommonSuffixLength(previousContent, nextContent, prefixLength);
  const previousEndOffset = previousContent.length - suffixLength;
  const nextEndOffset = nextContent.length - suffixLength;
  const removedLength = previousEndOffset - prefixLength;
  const insertedLength = nextEndOffset - prefixLength;

  if (
    removedLength < 0 ||
    insertedLength < 0 ||
    Math.max(removedLength, insertedLength) > INCREMENTAL_LINE_EDIT_THRESHOLD
  ) {
    return null;
  }

  const start = getLinePositionForOffset(previousLines, prefixLength);
  const end = getLinePositionForOffset(previousLines, previousEndOffset);
  const insertedText = nextContent.slice(prefixLength, nextEndOffset);
  const insertedLines = insertedText.split("\n");
  const linePrefix = previousLines[start.line]?.slice(0, start.column) ?? "";
  const lineSuffix = previousLines[end.line]?.slice(end.column) ?? "";
  const replacement =
    insertedLines.length === 1
      ? [`${linePrefix}${insertedLines[0]}${lineSuffix}`]
      : [
          `${linePrefix}${insertedLines[0]}`,
          ...insertedLines.slice(1, -1),
          `${insertedLines[insertedLines.length - 1]}${lineSuffix}`,
        ];

  return [
    ...previousLines.slice(0, start.line),
    ...replacement,
    ...previousLines.slice(end.line + 1),
  ];
}

// Subscribe to buffer changes and update computed values
useBufferStore.subscribe((state) => {
  const activeBuffer = state.actions.getActiveBuffer();
  if (activeBuffer && isEditorContent(activeBuffer)) {
    const previousSnapshot = previousActiveBufferSnapshot;

    if (
      previousSnapshot &&
      previousSnapshot.id === activeBuffer.id &&
      previousSnapshot.content === activeBuffer.content
    ) {
      return;
    }

    const largeEditorInfo = getLargeEditorModeInfo(activeBuffer.content);
    if (largeEditorInfo.largeContentMode) {
      const lines = createSparseLineArray(largeEditorInfo.lineCount);
      previousActiveBufferSnapshot = {
        id: activeBuffer.id,
        content: activeBuffer.content,
        lines,
      };
      useEditorViewStore.setState({
        lines,
        lineCount: largeEditorInfo.lineCount,
        lineTokens: new Map(),
      });
      return;
    }

    const previousLines = previousSnapshot?.id === activeBuffer.id ? previousSnapshot.lines : [""];
    const lines =
      previousSnapshot?.id === activeBuffer.id
        ? (applyIncrementalLineEdit(
            previousSnapshot.content,
            activeBuffer.content,
            previousLines,
          ) ?? activeBuffer.content.split("\n"))
        : activeBuffer.content.split("\n");

    previousActiveBufferSnapshot = {
      id: activeBuffer.id,
      content: activeBuffer.content,
      lines,
    };

    useEditorViewStore.setState({
      lines,
      lineCount: lines.length,
      lineTokens: new Map(),
    });
  } else {
    previousActiveBufferSnapshot = null;
    useEditorViewStore.setState({
      lines: [""],
      lineCount: 1,
      lineTokens: new Map(),
    });
  }
});
