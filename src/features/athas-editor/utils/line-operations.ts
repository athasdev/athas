export interface LineOperationResult {
  content: string;
  selectionStart: number;
  selectionEnd: number;
}

interface LineRange {
  start: number;
  end: number;
  text: string;
}

function getLineRangeAtOffset(content: string, offset: number): LineRange {
  const safeOffset = Math.max(0, Math.min(offset, content.length));
  const start = content.lastIndexOf("\n", Math.max(0, safeOffset - 1)) + 1;
  const nextLineBreak = content.indexOf("\n", safeOffset);
  const end = nextLineBreak === -1 ? content.length : nextLineBreak;

  return {
    start,
    end,
    text: content.slice(start, end),
  };
}

function getPreviousLineRange(content: string, lineStart: number): LineRange | null {
  if (lineStart <= 0) return null;

  const end = lineStart - 1;
  const start = content.lastIndexOf("\n", Math.max(0, end - 1)) + 1;

  return {
    start,
    end,
    text: content.slice(start, end),
  };
}

function getNextLineRange(content: string, lineEnd: number): LineRange | null {
  if (lineEnd >= content.length || content[lineEnd] !== "\n") return null;

  const start = lineEnd + 1;
  const nextLineBreak = content.indexOf("\n", start);
  const end = nextLineBreak === -1 ? content.length : nextLineBreak;

  return {
    start,
    end,
    text: content.slice(start, end),
  };
}

function cursorColumn(content: string, offset: number): number {
  const line = getLineRangeAtOffset(content, offset);
  return Math.max(0, Math.min(offset - line.start, line.text.length));
}

export function duplicateLine(content: string, offset: number): LineOperationResult {
  const line = getLineRangeAtOffset(content, offset);
  const column = cursorColumn(content, offset);
  const nextContent = `${content.slice(0, line.end)}\n${line.text}${content.slice(line.end)}`;
  const nextOffset = line.end + 1 + Math.min(column, line.text.length);

  return {
    content: nextContent,
    selectionStart: nextOffset,
    selectionEnd: nextOffset,
  };
}

export function deleteLine(content: string, offset: number): LineOperationResult {
  const line = getLineRangeAtOffset(content, offset);
  const removeEnd = line.end < content.length ? line.end + 1 : line.end;
  const nextContent = content.slice(0, line.start) + content.slice(removeEnd);
  const nextOffset = Math.min(line.start, nextContent.length);

  return {
    content: nextContent,
    selectionStart: nextOffset,
    selectionEnd: nextOffset,
  };
}

export function moveLineUp(content: string, offset: number): LineOperationResult | null {
  const line = getLineRangeAtOffset(content, offset);
  const previous = getPreviousLineRange(content, line.start);
  if (!previous) return null;

  const column = cursorColumn(content, offset);
  const nextContent = `${content.slice(0, previous.start)}${line.text}\n${previous.text}${content.slice(line.end)}`;
  const nextOffset = previous.start + Math.min(column, line.text.length);

  return {
    content: nextContent,
    selectionStart: nextOffset,
    selectionEnd: nextOffset,
  };
}

export function moveLineDown(content: string, offset: number): LineOperationResult | null {
  const line = getLineRangeAtOffset(content, offset);
  const next = getNextLineRange(content, line.end);
  if (!next) return null;

  const column = cursorColumn(content, offset);
  const nextContent = `${content.slice(0, line.start)}${next.text}\n${line.text}${content.slice(next.end)}`;
  const movedLineStart = line.start + next.text.length + 1;
  const nextOffset = movedLineStart + Math.min(column, line.text.length);

  return {
    content: nextContent,
    selectionStart: nextOffset,
    selectionEnd: nextOffset,
  };
}

export function copyLineUp(content: string, offset: number): LineOperationResult {
  const line = getLineRangeAtOffset(content, offset);
  const column = cursorColumn(content, offset);
  const nextContent = `${content.slice(0, line.start)}${line.text}\n${content.slice(line.start)}`;
  const nextOffset = line.start + Math.min(column, line.text.length);

  return {
    content: nextContent,
    selectionStart: nextOffset,
    selectionEnd: nextOffset,
  };
}

export function copyLineDown(content: string, offset: number): LineOperationResult {
  const line = getLineRangeAtOffset(content, offset);
  const column = cursorColumn(content, offset);
  const nextContent = `${content.slice(0, line.end)}\n${line.text}${content.slice(line.end)}`;
  const nextOffset = line.end + 1 + Math.min(column, line.text.length);

  return {
    content: nextContent,
    selectionStart: nextOffset,
    selectionEnd: nextOffset,
  };
}
