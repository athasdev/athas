import type { Position } from "@/features/editor/types/editor.types";
import { getNextWordOffset, getPreviousWordOffset } from "./word-navigation";

export interface LargeEditorSelectedOffsetRange {
  start: number;
  end: number;
}

export interface LargeEditorNavigationRequest {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  cursorPosition: Position;
  desiredColumn?: number;
  selectedRange?: LargeEditorSelectedOffsetRange | null;
  content: string;
  visualLineCount: number;
  lineHeight: number;
  viewportHeight: number;
  getLineText: (line: number) => string;
  getOffsetForPosition: (line: number, column: number) => number;
}

export interface LargeEditorNavigationCommand {
  offset: number;
  extendSelection: boolean;
  stopPropagation: boolean;
  desiredColumn?: number;
}

export interface LargeEditorDeletionRequest {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  cursorPosition: Position;
  selectedRange?: LargeEditorSelectedOffsetRange | null;
  content: string;
  visualLineCount: number;
  getLineText: (line: number) => string;
  getOffsetForPosition: (line: number, column: number) => number;
}

export interface LargeEditorDeletionCommand {
  start: number;
  end: number;
  stopPropagation: boolean;
  handled: boolean;
}

function clampLine(line: number, visualLineCount: number): number {
  return Math.max(0, Math.min(Math.max(0, visualLineCount - 1), line));
}

export function resolveLargeEditorNavigation({
  key,
  metaKey,
  ctrlKey,
  altKey,
  shiftKey,
  cursorPosition,
  desiredColumn,
  selectedRange,
  content,
  visualLineCount,
  lineHeight,
  viewportHeight,
  getLineText,
  getOffsetForPosition,
}: LargeEditorNavigationRequest): LargeEditorNavigationCommand | null {
  const lowerKey = key.toLowerCase();
  const command = (
    offset: number,
    stopPropagation = false,
    nextDesiredColumn?: number,
  ): LargeEditorNavigationCommand => ({
    offset,
    extendSelection: shiftKey,
    stopPropagation,
    desiredColumn: nextDesiredColumn,
  });
  const lineOffset = (line: number, column: number) =>
    getOffsetForPosition(clampLine(line, visualLineCount), column);

  if ((metaKey || ctrlKey) && !altKey) {
    if ((metaKey && lowerKey === "arrowup") || (ctrlKey && lowerKey === "home")) {
      return command(0, true);
    }

    if ((metaKey && lowerKey === "arrowdown") || (ctrlKey && lowerKey === "end")) {
      return command(content.length, true);
    }

    if (metaKey && lowerKey === "arrowleft") {
      return command(lineOffset(cursorPosition.line, 0), true);
    }

    if (metaKey && lowerKey === "arrowright") {
      return command(
        lineOffset(cursorPosition.line, getLineText(cursorPosition.line).length),
        true,
      );
    }

    if (ctrlKey && !metaKey && lowerKey === "arrowleft") {
      return command(getPreviousWordOffset(content, cursorPosition.offset), true);
    }

    if (ctrlKey && !metaKey && lowerKey === "arrowright") {
      return command(getNextWordOffset(content, cursorPosition.offset), true);
    }

    return null;
  }

  if (altKey && !metaKey && !ctrlKey && key === "ArrowLeft") {
    return command(getPreviousWordOffset(content, cursorPosition.offset));
  }

  if (altKey && !metaKey && !ctrlKey && key === "ArrowRight") {
    return command(getNextWordOffset(content, cursorPosition.offset));
  }

  if (key === "ArrowLeft") {
    return command(!shiftKey && selectedRange ? selectedRange.start : cursorPosition.offset - 1);
  }

  if (key === "ArrowRight") {
    return command(!shiftKey && selectedRange ? selectedRange.end : cursorPosition.offset + 1);
  }

  if (key === "ArrowUp" || key === "ArrowDown") {
    const direction = key === "ArrowUp" ? -1 : 1;
    const targetColumn = desiredColumn ?? cursorPosition.column;
    return command(lineOffset(cursorPosition.line + direction, targetColumn), false, targetColumn);
  }

  if (key === "Home") {
    return command(lineOffset(cursorPosition.line, 0));
  }

  if (key === "End") {
    return command(lineOffset(cursorPosition.line, getLineText(cursorPosition.line).length));
  }

  if (key === "PageUp" || key === "PageDown") {
    const viewportLines = Math.max(1, Math.floor(viewportHeight / lineHeight) - 1);
    const direction = key === "PageUp" ? -1 : 1;
    const targetColumn = desiredColumn ?? cursorPosition.column;
    return command(
      lineOffset(cursorPosition.line + direction * viewportLines, targetColumn),
      false,
      targetColumn,
    );
  }

  return null;
}

export function resolveLargeEditorDeletion({
  key,
  metaKey,
  ctrlKey,
  altKey,
  cursorPosition,
  selectedRange,
  content,
  visualLineCount,
  getLineText,
  getOffsetForPosition,
}: LargeEditorDeletionRequest): LargeEditorDeletionCommand | null {
  if (key !== "Backspace" && key !== "Delete") return null;

  const command = (start: number, end: number, stopPropagation = false) => {
    const safeStart = Math.max(0, Math.min(start, content.length));
    const safeEnd = Math.max(safeStart, Math.min(end, content.length));

    return {
      start: safeStart,
      end: safeEnd,
      stopPropagation,
      handled: true,
    };
  };

  if (selectedRange) {
    return command(selectedRange.start, selectedRange.end);
  }

  const lineOffset = (line: number, column: number) =>
    getOffsetForPosition(clampLine(line, visualLineCount), column);

  if (key === "Backspace") {
    if (metaKey && !altKey) {
      return command(lineOffset(cursorPosition.line, 0), cursorPosition.offset, true);
    }

    if ((altKey && !metaKey) || (ctrlKey && !metaKey)) {
      return command(getPreviousWordOffset(content, cursorPosition.offset), cursorPosition.offset);
    }

    return command(cursorPosition.offset - 1, cursorPosition.offset);
  }

  if (metaKey && !altKey) {
    return command(
      cursorPosition.offset,
      lineOffset(cursorPosition.line, getLineText(cursorPosition.line).length),
      true,
    );
  }

  if ((altKey && !metaKey) || (ctrlKey && !metaKey)) {
    return command(cursorPosition.offset, getNextWordOffset(content, cursorPosition.offset));
  }

  return command(cursorPosition.offset, cursorPosition.offset + 1);
}
