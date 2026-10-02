import isEqual from "fast-deep-equal";
import { createWithEqualityFn } from "zustand/traditional";
import { isEditorContent } from "@/features/panes/types/pane-content.types";
import { createSelectors } from "@/utils/zustand-selectors";
import type { EditorDocumentChangeBatch, EditorTextChange } from "../types/editor.types";
import {
  applyEditorChangesToLargeEditorModeInfo,
  createSparseLineArray,
  getLargeEditorModeInfo,
  type LargeEditorModeInfo,
} from "../utils/large-file";
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
  contentRevision: number;
  contentLength: number;
  lines: string[];
  largeEditorInfo: LargeEditorModeInfo;
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

export function applyEditorTextChangeToLines(
  previousLines: string[],
  change: EditorTextChange,
): string[] | null {
  if (isSparseLineArray(previousLines)) return null;

  const { startLine, startColumn, endLine, endColumn } = change;
  if (
    startLine === undefined ||
    startColumn === undefined ||
    endLine === undefined ||
    endColumn === undefined ||
    startLine < 0 ||
    endLine < startLine ||
    endLine >= previousLines.length ||
    Math.max(change.rangeLength, change.text.length) > INCREMENTAL_LINE_EDIT_THRESHOLD
  ) {
    return null;
  }

  const startLineText = previousLines[startLine] ?? "";
  const endLineText = previousLines[endLine] ?? "";
  if (
    startColumn < 0 ||
    startColumn > startLineText.length ||
    endColumn < 0 ||
    endColumn > endLineText.length
  ) {
    return null;
  }

  const insertedLines = change.text.split("\n");
  const linePrefix = startLineText.slice(0, startColumn);
  const lineSuffix = endLineText.slice(endColumn);
  const replacement =
    insertedLines.length === 1
      ? [`${linePrefix}${insertedLines[0]}${lineSuffix}`]
      : [
          `${linePrefix}${insertedLines[0]}`,
          ...insertedLines.slice(1, -1),
          `${insertedLines[insertedLines.length - 1]}${lineSuffix}`,
        ];

  return [
    ...previousLines.slice(0, startLine),
    ...replacement,
    ...previousLines.slice(endLine + 1),
  ];
}

export function applyEditorTextChangesToLines(
  previousLines: string[],
  changes: readonly EditorTextChange[],
): string[] | null {
  let lines = previousLines;
  const descendingChanges = [...changes].sort(
    (left, right) =>
      (right.startLine ?? 0) - (left.startLine ?? 0) ||
      (right.startColumn ?? 0) - (left.startColumn ?? 0),
  );
  for (const change of descendingChanges) {
    const nextLines = applyEditorTextChangeToLines(lines, change);
    if (!nextLines) return null;
    lines = nextLines;
  }
  return lines;
}

interface PendingEditorViewContentChange {
  previousContentRevision: number;
  batch: EditorDocumentChangeBatch;
}

const pendingEditorViewContentChanges = new Map<string, PendingEditorViewContentChange>();

export function queueEditorViewContentChange(
  bufferId: string,
  previousContentRevision: number,
  batch: EditorDocumentChangeBatch,
): void {
  pendingEditorViewContentChanges.set(bufferId, {
    previousContentRevision,
    batch,
  });
}

export function discardEditorViewContentChange(bufferId: string): void {
  pendingEditorViewContentChanges.delete(bufferId);
}

// Subscribe to buffer changes and update computed values
useBufferStore.subscribe((state) => {
  const activeBuffer = state.actions.getActiveBuffer();
  if (activeBuffer && isEditorContent(activeBuffer)) {
    const previousSnapshot = previousActiveBufferSnapshot;

    if (
      previousSnapshot &&
      previousSnapshot.id === activeBuffer.id &&
      previousSnapshot.contentRevision === (activeBuffer.contentRevision ?? 0) &&
      previousSnapshot.content === activeBuffer.content
    ) {
      return;
    }

    const pendingContentChange = pendingEditorViewContentChanges.get(activeBuffer.id);
    pendingEditorViewContentChanges.delete(activeBuffer.id);
    const canApplyPendingChange =
      previousSnapshot?.id === activeBuffer.id &&
      pendingContentChange?.previousContentRevision === previousSnapshot.contentRevision &&
      !pendingContentChange.batch.isEolChange &&
      !pendingContentChange.batch.isFlush;
    const incrementalLargeEditorInfo = canApplyPendingChange
      ? applyEditorChangesToLargeEditorModeInfo(
          previousSnapshot.contentLength,
          previousSnapshot.largeEditorInfo,
          pendingContentChange.batch.changes,
        )
      : null;
    const largeEditorInfo =
      incrementalLargeEditorInfo ?? getLargeEditorModeInfo(activeBuffer.content);
    if (largeEditorInfo.largeContentMode) {
      const lines: string[] = [];
      previousActiveBufferSnapshot = {
        id: activeBuffer.id,
        content: activeBuffer.content,
        contentRevision: activeBuffer.contentRevision ?? 0,
        contentLength: activeBuffer.content.length,
        lines,
        largeEditorInfo,
      };
      useEditorViewStore.setState({
        lines,
        lineCount: largeEditorInfo.lineCount,
      });
      return;
    }

    const previousLines = previousSnapshot?.id === activeBuffer.id ? previousSnapshot.lines : [""];
    const changedLines = canApplyPendingChange
      ? applyEditorTextChangesToLines(previousLines, pendingContentChange.batch.changes)
      : null;
    const lines =
      previousSnapshot?.id === activeBuffer.id
        ? (changedLines ?? activeBuffer.content.split("\n"))
        : activeBuffer.content.split("\n");

    previousActiveBufferSnapshot = {
      id: activeBuffer.id,
      content: activeBuffer.content,
      contentRevision: activeBuffer.contentRevision ?? 0,
      contentLength: activeBuffer.content.length,
      lines,
      largeEditorInfo,
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
