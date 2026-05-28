/**
 * Multi-cursor editing utilities
 * Handles text insertion, deletion, and cursor position updates for multiple cursors
 */

import type { Cursor, MultiCursorState, Position } from "@/features/editor/types/editor";

interface CursorEdit {
  cursor: Cursor;
  startOffset: number;
  endOffset: number;
  text: string;
}

function buildLineStartOffsets(content: string): number[] {
  const offsets = [0];

  for (let index = 0; index < content.length; index++) {
    if (content.charCodeAt(index) === 10) {
      offsets.push(index + 1);
    }
  }

  return offsets;
}

function getOffsetForPosition(content: string, lineStarts: number[], position: Position): number {
  const line = Math.max(0, Math.trunc(position.line));
  if (line >= lineStarts.length) {
    return content.length;
  }

  const lineStart = lineStarts[line] ?? 0;
  const nextLineStart = lineStarts[line + 1];
  const lineEnd =
    nextLineStart === undefined ? content.length : Math.max(lineStart, nextLineStart - 1);
  const column = Math.max(0, Math.trunc(position.column));

  return Math.max(0, Math.min(content.length, lineStart + Math.min(column, lineEnd - lineStart)));
}

function getPositionForOffset(content: string, lineStarts: number[], offset: number): Position {
  const clampedOffset = Math.max(0, Math.min(offset, content.length));
  let low = 0;
  let high = lineStarts.length - 1;
  let line = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const lineStart = lineStarts[mid] ?? 0;
    const nextLineStart = lineStarts[mid + 1] ?? Number.POSITIVE_INFINITY;

    if (clampedOffset < lineStart) {
      high = mid - 1;
    } else if (clampedOffset >= nextLineStart) {
      low = mid + 1;
    } else {
      line = mid;
      break;
    }
  }

  return {
    line,
    column: clampedOffset - (lineStarts[line] ?? 0),
    offset: clampedOffset,
  };
}

function getLineEndOffset(content: string, lineStarts: number[], line: number): number {
  const safeLine = Math.max(0, Math.min(line, lineStarts.length - 1));
  const lineStart = lineStarts[safeLine] ?? 0;
  const nextLineStart = lineStarts[safeLine + 1];
  let lineEnd =
    nextLineStart === undefined ? content.length : Math.max(lineStart, nextLineStart - 1);

  if (lineEnd > lineStart && content.charCodeAt(lineEnd - 1) === 13) {
    lineEnd--;
  }

  return lineEnd;
}

function getOffsetForLineColumn(
  content: string,
  lineStarts: number[],
  line: number,
  column: number,
): number {
  const safeLine = Math.max(0, Math.min(line, lineStarts.length - 1));
  const lineStart = lineStarts[safeLine] ?? 0;
  const lineEnd = getLineEndOffset(content, lineStarts, safeLine);

  return lineStart + Math.max(0, Math.min(column, lineEnd - lineStart));
}

function getCursorOffsetRange(content: string, lineStarts: number[], cursor: Cursor) {
  const offset = getOffsetForPosition(content, lineStarts, cursor.position);

  if (!cursor.selection) {
    return { startOffset: offset, endOffset: offset };
  }

  const startOffset = getOffsetForPosition(content, lineStarts, cursor.selection.start);
  const endOffset = getOffsetForPosition(content, lineStarts, cursor.selection.end);
  return {
    startOffset: Math.min(startOffset, endOffset),
    endOffset: Math.max(startOffset, endOffset),
  };
}

function applyCursorEdits(content: string, edits: CursorEdit[]) {
  const sortedEdits = [...edits].sort(
    (a, b) => b.startOffset - a.startOffset || b.endOffset - a.endOffset,
  );
  const ascendingEdits = [...edits].sort(
    (a, b) => a.startOffset - b.startOffset || a.endOffset - b.endOffset,
  );
  const finalOffsets = new Map<CursorEdit, number>();
  let accumulatedDelta = 0;
  let index = 0;

  while (index < ascendingEdits.length) {
    const startOffset = ascendingEdits[index].startOffset;
    let groupEnd = index + 1;
    let groupDelta = 0;

    while (
      groupEnd < ascendingEdits.length &&
      ascendingEdits[groupEnd].startOffset === startOffset
    ) {
      groupEnd++;
    }

    for (let groupIndex = index; groupIndex < groupEnd; groupIndex++) {
      const edit = ascendingEdits[groupIndex];
      finalOffsets.set(edit, edit.startOffset + edit.text.length + accumulatedDelta);
      groupDelta += edit.text.length - (edit.endOffset - edit.startOffset);
    }

    accumulatedDelta += groupDelta;
    index = groupEnd;
  }

  let nextContent = content;

  for (const edit of sortedEdits) {
    if (edit.startOffset === edit.endOffset && edit.text.length === 0) continue;
    nextContent =
      nextContent.slice(0, edit.startOffset) + edit.text + nextContent.slice(edit.endOffset);
  }

  const finalLineStarts = buildLineStartOffsets(nextContent);
  const newCursors = edits.map((edit) => {
    const finalOffset = finalOffsets.get(edit) ?? edit.startOffset + edit.text.length;

    return {
      ...edit.cursor,
      position: getPositionForOffset(nextContent, finalLineStarts, finalOffset),
      selection: undefined,
    };
  });

  return { newContent: nextContent, newCursors };
}

/**
 * Apply text insertion at multiple cursor positions
 * Processes cursors from bottom to top to maintain position validity
 */
export function applyMultiCursorEdit(
  content: string,
  cursors: Cursor[],
  text: string,
): { newContent: string; newCursors: Cursor[] } {
  const lineStarts = buildLineStartOffsets(content);
  const edits = cursors.map((cursor) => {
    const range = getCursorOffsetRange(content, lineStarts, cursor);
    return {
      cursor,
      startOffset: range.startOffset,
      endOffset: range.endOffset,
      text,
    };
  });

  return applyCursorEdits(content, edits);
}

/**
 * Apply backspace at multiple cursor positions
 */
export function applyMultiCursorBackspace(
  content: string,
  cursors: Cursor[],
): { newContent: string; newCursors: Cursor[] } {
  const lineStarts = buildLineStartOffsets(content);
  const edits = cursors.map((cursor) => {
    const range = getCursorOffsetRange(content, lineStarts, cursor);

    if (range.startOffset !== range.endOffset) {
      return {
        cursor,
        startOffset: range.startOffset,
        endOffset: range.endOffset,
        text: "",
      };
    }

    if (range.startOffset === 0) {
      return {
        cursor,
        startOffset: range.startOffset,
        endOffset: range.endOffset,
        text: "",
      };
    }

    return {
      cursor,
      startOffset: range.startOffset - 1,
      endOffset: range.startOffset,
      text: "",
    };
  });

  return applyCursorEdits(content, edits);
}

export interface MultiCursorKeyEditResult {
  newContent: string;
  newCursors: Cursor[];
  primaryCursor: Cursor | null;
}

export function resolveMultiCursorKeyEdit({
  content,
  key,
  multiCursorState,
  hasBlockedModifier = false,
}: {
  content: string;
  key: string;
  multiCursorState: MultiCursorState | null;
  hasBlockedModifier?: boolean;
}): MultiCursorKeyEditResult | null {
  if (!multiCursorState || multiCursorState.cursors.length <= 1 || hasBlockedModifier) {
    return null;
  }

  const result =
    key === "Backspace"
      ? applyMultiCursorBackspace(content, multiCursorState.cursors)
      : key.length === 1 || key === "Enter"
        ? applyMultiCursorEdit(content, multiCursorState.cursors, key === "Enter" ? "\n" : key)
        : null;

  if (!result) return null;

  return {
    ...result,
    primaryCursor:
      result.newCursors.find((cursor) => cursor.id === multiCursorState.primaryCursorId) ?? null,
  };
}

export function resolveCursorPositionsAtLineEndsForSelection({
  content,
  selection,
}: {
  content: string;
  selection?: { start: Position; end: Position } | null;
}): Position[] {
  if (!selection || selection.start.offset === selection.end.offset) return [];

  const start = selection.start.offset <= selection.end.offset ? selection.start : selection.end;
  const end = selection.start.offset <= selection.end.offset ? selection.end : selection.start;
  const lineStarts = buildLineStartOffsets(content);
  const positions: Position[] = [];

  for (let line = start.line; line < end.line; line++) {
    positions.push(
      getPositionForOffset(content, lineStarts, getLineEndOffset(content, lineStarts, line)),
    );
  }

  if (end.column > 0) {
    positions.push(
      getPositionForOffset(
        content,
        lineStarts,
        getOffsetForLineColumn(content, lineStarts, end.line, end.column),
      ),
    );
  }

  return positions;
}
