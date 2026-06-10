import type { RenderWhitespaceMode } from "@/features/settings/types/settings.types";

export type VisibleWhitespaceKind = "space" | "tab";

export interface VisibleWhitespaceSegment {
  text: string;
  kind: VisibleWhitespaceKind | null;
  start: number;
}

function isVisibleWhitespaceCandidate(char: string): boolean {
  return char === " " || char === "\t";
}

function getTrailingWhitespaceStart(line: string): number {
  let start = line.length;
  while (start > 0 && isVisibleWhitespaceCandidate(line[start - 1])) {
    start--;
  }
  return start;
}

function getWhitespaceRun(line: string, index: number): { start: number; end: number } {
  let start = index;
  while (start > 0 && isVisibleWhitespaceCandidate(line[start - 1])) {
    start--;
  }

  let end = index + 1;
  while (end < line.length && isVisibleWhitespaceCandidate(line[end])) {
    end++;
  }

  return { start, end };
}

export function splitVisibleWhitespaceSegments(
  line: string,
  start: number,
  end: number,
  mode: RenderWhitespaceMode,
): VisibleWhitespaceSegment[] {
  if (mode === "none") {
    return [{ text: line.slice(start, end), kind: null, start }];
  }

  const segments: VisibleWhitespaceSegment[] = [];
  const trailingWhitespaceStart =
    mode === "trailing" ? getTrailingWhitespaceStart(line) : line.length;
  let cursor = start;

  while (cursor < end) {
    if (!isVisibleWhitespaceCandidate(line[cursor])) {
      const textStart = cursor;
      while (cursor < end && !isVisibleWhitespaceCandidate(line[cursor])) {
        cursor++;
      }
      segments.push({
        text: line.slice(textStart, cursor),
        kind: null,
        start: textStart,
      });
      continue;
    }

    const run = getWhitespaceRun(line, cursor);
    const segmentRunStart = Math.max(run.start, start);
    const segmentRunEnd = Math.min(run.end, end);
    const containsTab = line.slice(run.start, run.end).includes("\t");
    const isVisibleRun =
      mode === "all" ||
      (mode === "trailing" && run.start >= trailingWhitespaceStart) ||
      (mode === "boundary" &&
        (run.start === 0 || run.end === line.length || containsTab || run.end - run.start > 1));

    if (!isVisibleRun) {
      segments.push({
        text: line.slice(segmentRunStart, segmentRunEnd),
        kind: null,
        start: segmentRunStart,
      });
      cursor = segmentRunEnd;
      continue;
    }

    for (let index = segmentRunStart; index < segmentRunEnd; index++) {
      const char = line[index];
      segments.push({
        text: char,
        kind: char === "\t" ? "tab" : "space",
        start: index,
      });
    }
    cursor = segmentRunEnd;
  }

  return segments;
}
