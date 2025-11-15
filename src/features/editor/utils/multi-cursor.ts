/**
 * Multi-cursor editing utilities
 * Handles text insertion, deletion, and cursor position updates for multiple cursors
 */

import type { Cursor, Position } from "../types/editor";

/**
 * Apply text insertion at multiple cursor positions
 * Processes cursors from bottom to top to maintain position validity
 */
export function applyMultiCursorEdit(
  content: string,
  cursors: Cursor[],
  text: string,
): { newContent: string; newCursors: Cursor[] } {
  // Sort cursors by position (bottom to top) to avoid invalidating positions
  const sortedCursors = [...cursors].sort((a, b) => {
    if (a.position.line !== b.position.line) {
      return b.position.line - a.position.line; // Reverse order (bottom first)
    }
    return b.position.column - a.position.column; // Reverse order
  });

  let newContent = content;
  const positionUpdates = new Map<string, Position>();

  // Apply edits from bottom to top
  for (const cursor of sortedCursors) {
    const { position, selection, id } = cursor;

    // Calculate the offset in the current content
    const lines = newContent.split("\n");
    const offset = calculateOffset(lines, position.line, position.column);

    // Handle selection deletion if exists
    let deleteStart = offset;
    let deleteEnd = offset;

    if (selection) {
      const startOffset = calculateOffset(lines, selection.start.line, selection.start.column);
      const endOffset = calculateOffset(lines, selection.end.line, selection.end.column);
      deleteStart = Math.min(startOffset, endOffset);
      deleteEnd = Math.max(startOffset, endOffset);
    }

    // Delete selected text (if any) and insert new text
    newContent = newContent.substring(0, deleteStart) + text + newContent.substring(deleteEnd);

    // Calculate new cursor position
    const newOffset = deleteStart + text.length;
    const newLines = newContent.split("\n");
    const newPosition = calculatePositionFromOffset(newLines, newOffset);

    positionUpdates.set(id, newPosition);
  }

  // Update cursor positions
  const newCursors = cursors.map((cursor) => {
    const newPosition = positionUpdates.get(cursor.id);
    if (newPosition) {
      return {
        ...cursor,
        position: newPosition,
        selection: undefined, // Clear selection after edit
      };
    }
    return cursor;
  });

  return { newContent, newCursors };
}

/**
 * Apply backspace at multiple cursor positions
 */
export function applyMultiCursorBackspace(
  content: string,
  cursors: Cursor[],
): { newContent: string; newCursors: Cursor[] } {
  const sortedCursors = [...cursors].sort((a, b) => {
    if (a.position.line !== b.position.line) {
      return b.position.line - a.position.line;
    }
    return b.position.column - a.position.column;
  });

  let newContent = content;
  const positionUpdates = new Map<string, Position>();

  for (const cursor of sortedCursors) {
    const { position, selection, id } = cursor;
    const lines = newContent.split("\n");
    const offset = calculateOffset(lines, position.line, position.column);

    let deleteStart: number;
    let deleteEnd: number;

    if (selection) {
      // Delete selection
      const startOffset = calculateOffset(lines, selection.start.line, selection.start.column);
      const endOffset = calculateOffset(lines, selection.end.line, selection.end.column);
      deleteStart = Math.min(startOffset, endOffset);
      deleteEnd = Math.max(startOffset, endOffset);
    } else if (offset > 0) {
      // Delete one character before cursor
      deleteStart = offset - 1;
      deleteEnd = offset;
    } else {
      // At start of document, nothing to delete
      continue;
    }

    newContent = newContent.substring(0, deleteStart) + newContent.substring(deleteEnd);

    const newLines = newContent.split("\n");
    const newPosition = calculatePositionFromOffset(newLines, deleteStart);
    positionUpdates.set(id, newPosition);
  }

  const newCursors = cursors.map((cursor) => {
    const newPosition = positionUpdates.get(cursor.id);
    if (newPosition) {
      return {
        ...cursor,
        position: newPosition,
        selection: undefined,
      };
    }
    return cursor;
  });

  return { newContent, newCursors };
}

/**
 * Calculate byte offset from line and column
 */
function calculateOffset(lines: string[], line: number, column: number): number {
  let offset = 0;

  for (let i = 0; i < line && i < lines.length; i++) {
    offset += lines[i].length + 1; // +1 for newline
  }

  offset += Math.min(column, lines[line]?.length || 0);

  return offset;
}

/**
 * Calculate position from byte offset
 */
function calculatePositionFromOffset(lines: string[], offset: number): Position {
  let currentOffset = 0;

  for (let line = 0; line < lines.length; line++) {
    const lineLength = lines[line].length;

    if (currentOffset + lineLength >= offset) {
      return {
        line,
        column: offset - currentOffset,
        offset,
      };
    }

    currentOffset += lineLength + 1; // +1 for newline
  }

  // Fallback: end of document
  return {
    line: Math.max(0, lines.length - 1),
    column: lines[lines.length - 1]?.length || 0,
    offset,
  };
}
