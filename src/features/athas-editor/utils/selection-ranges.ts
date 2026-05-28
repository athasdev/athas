import type { Position, Range } from "@/features/editor/types/editor";
import { findBracketSelectionRange } from "./bracket-matching";
import { getWordRangeAtOffset } from "./word-navigation";

export interface OffsetRange {
  start: number;
  end: number;
}

type TextareaSelectionState = Pick<
  HTMLTextAreaElement,
  "selectionStart" | "selectionEnd" | "selectionDirection"
>;

export interface SmartSelectionOptions {
  content: string;
  cursorOffset: number;
  selectionStart?: number;
  selectionEnd?: number;
}

export function getSelectionAnchorForCursor(selection: Range | undefined, cursor: Position) {
  if (!selection) return cursor;

  return cursor.offset === selection.start.offset ? selection.end : selection.start;
}

export function getTextareaSelectionFocusOffset(textarea: TextareaSelectionState): number {
  if (textarea.selectionStart === textarea.selectionEnd) {
    return textarea.selectionStart;
  }

  return textarea.selectionDirection === "backward"
    ? textarea.selectionStart
    : textarea.selectionEnd;
}

export function getTextareaSelectionAnchorOffset(textarea: TextareaSelectionState): number {
  if (textarea.selectionStart === textarea.selectionEnd) {
    return textarea.selectionStart;
  }

  return textarea.selectionDirection === "backward"
    ? textarea.selectionEnd
    : textarea.selectionStart;
}

export function buildSelectionFromAnchor(anchor: Position, cursor: Position): Range | undefined {
  if (anchor.offset === cursor.offset) return undefined;

  return { start: anchor, end: cursor };
}

function normalizeOffsetRange(start: number, end: number): OffsetRange | null {
  if (start === end) return null;
  return start < end ? { start, end } : { start: end, end: start };
}

function containsRange(container: OffsetRange, candidate: OffsetRange): boolean {
  return container.start <= candidate.start && container.end >= candidate.end;
}

function rangeKey(range: OffsetRange): string {
  return `${range.start}:${range.end}`;
}

function getLineRangeAtOffset(content: string, offset: number): OffsetRange | null {
  const safeOffset = Math.max(0, Math.min(offset, content.length));
  const lineStart = content.lastIndexOf("\n", Math.max(0, safeOffset - 1)) + 1;
  const nextLineBreak = content.indexOf("\n", safeOffset);
  const lineEnd = nextLineBreak === -1 ? content.length : nextLineBreak;

  return normalizeOffsetRange(lineStart, lineEnd);
}

export function getSmartSelectionRanges({
  content,
  cursorOffset,
  selectionStart,
  selectionEnd,
}: SmartSelectionOptions): OffsetRange[] {
  if (content.length === 0) return [];

  const currentRange =
    selectionStart !== undefined && selectionEnd !== undefined
      ? normalizeOffsetRange(selectionStart, selectionEnd)
      : null;
  const probeOffset = currentRange
    ? Math.min(currentRange.end, currentRange.start + 1)
    : Math.max(0, Math.min(cursorOffset, content.length));
  const candidates: OffsetRange[] = [];

  const wordRange = getWordRangeAtOffset(content, probeOffset);
  if (wordRange) candidates.push(wordRange);

  const bracketInnerRange = findBracketSelectionRange(content, probeOffset, {
    selectBrackets: false,
  });
  if (bracketInnerRange) {
    candidates.push({ start: bracketInnerRange.startOffset, end: bracketInnerRange.endOffset });
  }

  const bracketRange = findBracketSelectionRange(content, probeOffset, {
    selectBrackets: true,
  });
  if (bracketRange) {
    candidates.push({ start: bracketRange.startOffset, end: bracketRange.endOffset });
  }

  const lineRange = getLineRangeAtOffset(content, probeOffset);
  if (lineRange) candidates.push(lineRange);

  candidates.push({ start: 0, end: content.length });

  const uniqueRanges = new Map<string, OffsetRange>();
  for (const candidate of candidates) {
    const normalized = normalizeOffsetRange(candidate.start, candidate.end);
    if (!normalized) continue;

    const containsProbe = normalized.start <= probeOffset && normalized.end >= probeOffset;
    if (!containsProbe) continue;

    uniqueRanges.set(rangeKey(normalized), normalized);
  }

  return [...uniqueRanges.values()].sort((a, b) => {
    const lengthDelta = a.end - a.start - (b.end - b.start);
    return lengthDelta === 0 ? a.start - b.start : lengthDelta;
  });
}

export function resolveExpandSelection(options: SmartSelectionOptions): OffsetRange | null {
  const currentRange =
    options.selectionStart !== undefined && options.selectionEnd !== undefined
      ? normalizeOffsetRange(options.selectionStart, options.selectionEnd)
      : null;
  const ranges = getSmartSelectionRanges(options);

  if (!currentRange) return ranges[0] ?? null;

  return (
    ranges.find(
      (range) =>
        containsRange(range, currentRange) &&
        (range.start !== currentRange.start || range.end !== currentRange.end),
    ) ?? null
  );
}

export function resolveShrinkSelection(options: SmartSelectionOptions): OffsetRange | null {
  const currentRange =
    options.selectionStart !== undefined && options.selectionEnd !== undefined
      ? normalizeOffsetRange(options.selectionStart, options.selectionEnd)
      : null;
  if (!currentRange) return null;

  const ranges = getSmartSelectionRanges(options).filter(
    (range) =>
      containsRange(currentRange, range) &&
      (range.start !== currentRange.start || range.end !== currentRange.end),
  );

  return ranges[ranges.length - 1] ?? null;
}
