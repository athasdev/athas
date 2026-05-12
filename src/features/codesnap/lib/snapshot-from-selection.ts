import type { SourceSnapshot } from "../types";

type Position = { line: number; column: number };
type SelectionInput = { start: Position; end: Position } | null;
type BufferInput = { content: string; path: string | null; language: string } | null;

function offsetFor(content: string, pos: Position): number {
  const lines = content.split("\n");
  let offset = 0;
  for (let i = 0; i < pos.line && i < lines.length; i++) {
    offset += lines[i].length + 1; // +1 for the newline
  }
  return offset + Math.min(pos.column, (lines[pos.line] ?? "").length);
}

export function buildSnapshotFromSelection(
  selection: SelectionInput,
  buffer: BufferInput,
): SourceSnapshot | null {
  if (!buffer) return null;

  // Treat null or zero-width selections as "active line".
  const isEmpty =
    !selection ||
    (selection.start.line === selection.end.line &&
      selection.start.column === selection.end.column);

  if (isEmpty) {
    const line = selection?.start.line ?? 0;
    const lines = buffer.content.split("\n");
    const text = lines[line] ?? "";
    return {
      text,
      startLine: line + 1,
      endLine: line + 1,
      language: buffer.language,
      bufferPath: buffer.path,
    };
  }

  const startOffset = offsetFor(buffer.content, selection!.start);
  const endOffset = offsetFor(buffer.content, selection!.end);
  return {
    text: buffer.content.slice(startOffset, endOffset),
    startLine: selection!.start.line + 1,
    endLine: selection!.end.line + 1,
    language: buffer.language,
    bufferPath: buffer.path,
  };
}

export function buildSnapshotFromBuffer(buffer: BufferInput): SourceSnapshot | null {
  if (!buffer) return null;
  const lines = buffer.content.split("\n");
  return {
    text: buffer.content,
    startLine: 1,
    endLine: lines.length,
    language: buffer.language,
    bufferPath: buffer.path,
  };
}
