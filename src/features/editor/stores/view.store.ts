import isEqual from "fast-deep-equal";
import { createWithEqualityFn } from "zustand/traditional";
import { isEditorContent } from "@/features/panes/types/pane-content.types";
import { createSelectors } from "@/utils/zustand-selectors";
import { createSparseLineArray, getLargeEditorModeInfo } from "../utils/large-file";
import { useBufferStore } from "./buffer.store";

interface EditorViewState {
  // Computed views of the active buffer
  lines: string[];
  lineCount: number;

  // Actions
  actions: {
    getLines: () => string[];
    getLineCount: () => number;
    getContent: () => string;
  };
}

export const useEditorViewStore = createSelectors(
  createWithEqualityFn<EditorViewState>()(
    (_set, get) => ({
      // These will be computed from the active buffer
      lines: [""],
      lineCount: 1,

      actions: {
        getLines: () => {
          const { lines, lineCount } = get();
          if (lines.length > 0) return lines;
          return createSparseLineArray(lineCount);
        },

        getLineCount: () => get().lineCount,

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
      const lines: string[] = [];
      previousActiveBufferSnapshot = {
        id: activeBuffer.id,
        content: activeBuffer.content,
        lines,
      };
      useEditorViewStore.setState({
        lines,
        lineCount: largeEditorInfo.lineCount,
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
    });
  } else {
    previousActiveBufferSnapshot = null;
    useEditorViewStore.setState({
      lines: [""],
      lineCount: 1,
    });
  }
});
