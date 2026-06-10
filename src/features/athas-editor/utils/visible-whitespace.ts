import type { RenderWhitespaceMode } from "@/features/settings/types/settings.types";

const MAX_VISIBLE_WHITESPACE_LINE_LENGTH = 20_000;

export type VisibleWhitespaceKind = "space" | "tab";

export interface VisibleWhitespaceSegment {
  text: string;
  kind: VisibleWhitespaceKind | null;
  start: number;
}

function isVisibleWhitespaceCandidate(char: string): boolean {
  return char === " " || char === "\t";
}

function markRun(mask: Uint8Array, line: string, start: number, end: number): void {
  for (let index = start; index < end; index++) {
    mask[index] = line[index] === "\t" ? 2 : 1;
  }
}

function markTrailingWhitespace(mask: Uint8Array, line: string): void {
  let start = line.length;
  while (start > 0 && isVisibleWhitespaceCandidate(line[start - 1])) {
    start--;
  }

  if (start < line.length) {
    markRun(mask, line, start, line.length);
  }
}

export function createVisibleWhitespaceMask(
  line: string,
  mode: RenderWhitespaceMode,
): Uint8Array | null {
  if (mode === "none" || line.length === 0 || line.length > MAX_VISIBLE_WHITESPACE_LINE_LENGTH) {
    return null;
  }

  const mask = new Uint8Array(line.length);

  if (mode === "all") {
    for (let index = 0; index < line.length; index++) {
      if (isVisibleWhitespaceCandidate(line[index])) {
        mask[index] = line[index] === "\t" ? 2 : 1;
      }
    }
    return mask;
  }

  if (mode === "trailing") {
    markTrailingWhitespace(mask, line);
    return mask;
  }

  let index = 0;
  while (index < line.length) {
    if (!isVisibleWhitespaceCandidate(line[index])) {
      index++;
      continue;
    }

    const runStart = index;
    let containsTab = false;
    while (index < line.length && isVisibleWhitespaceCandidate(line[index])) {
      containsTab ||= line[index] === "\t";
      index++;
    }

    const runEnd = index;
    const isLeading = runStart === 0;
    const isTrailing = runEnd === line.length;
    const isBoundaryRun = isLeading || isTrailing || containsTab || runEnd - runStart > 1;

    if (isBoundaryRun) {
      markRun(mask, line, runStart, runEnd);
    }
  }

  return mask;
}

export function splitVisibleWhitespaceSegments(
  line: string,
  start: number,
  end: number,
  mask: Uint8Array | null,
): VisibleWhitespaceSegment[] {
  if (!mask) {
    return [{ text: line.slice(start, end), kind: null, start }];
  }

  const segments: VisibleWhitespaceSegment[] = [];
  let cursor = start;

  while (cursor < end) {
    const marker = mask[cursor];
    if (marker) {
      segments.push({
        text: line[cursor],
        kind: marker === 2 ? "tab" : "space",
        start: cursor,
      });
      cursor++;
      continue;
    }

    const textStart = cursor;
    while (cursor < end && !mask[cursor]) {
      cursor++;
    }
    segments.push({
      text: line.slice(textStart, cursor),
      kind: null,
      start: textStart,
    });
  }

  return segments;
}
