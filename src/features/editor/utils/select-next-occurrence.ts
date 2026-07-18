import { getWordRangeAtOffset } from "./word-navigation";

export interface OccurrenceRange {
  start: number;
  end: number;
}

export interface ResolveNextOccurrenceOptions {
  content: string;
  cursorOffset: number;
  selectionStart?: number;
  selectionEnd?: number;
}

export type OccurrenceDirection = "next" | "previous";

export interface ResolveSelectNextOccurrenceActionOptions {
  content: string;
  cursorOffset: number;
  currentSelection?: OccurrenceRange | null;
  selectedRanges?: OccurrenceRange[];
}

export interface ResolveAllOccurrencesOptions {
  content: string;
  cursorOffset: number;
  selectionStart?: number;
  selectionEnd?: number;
  maxOccurrences?: number;
}

export type SelectNextOccurrenceAction =
  | {
      type: "select-initial";
      range: OccurrenceRange;
    }
  | {
      type: "add-next";
      searchRange: OccurrenceRange;
      nextRange: OccurrenceRange;
    };

export type SelectOccurrenceAction = SelectNextOccurrenceAction;

function normalizeRange(start: number, end: number): OccurrenceRange | null {
  if (start === end) return null;
  return start < end ? { start, end } : { start: end, end: start };
}

function normalizeOccurrenceRange(range: OccurrenceRange): OccurrenceRange | null {
  return normalizeRange(range.start, range.end);
}

function rangesOverlap(start: number, end: number, ranges: OccurrenceRange[]): boolean {
  return ranges.some((range) => start < range.end && end > range.start);
}

function findNextAvailableOccurrence({
  content,
  searchText,
  searchFrom,
  selectedRanges,
}: {
  content: string;
  searchText: string;
  searchFrom: number;
  selectedRanges: OccurrenceRange[];
}): OccurrenceRange | null {
  const step = Math.max(searchText.length, 1);
  let index = content.indexOf(searchText, searchFrom);

  while (index !== -1) {
    const end = index + searchText.length;
    if (!rangesOverlap(index, end, selectedRanges)) {
      return { start: index, end };
    }
    index = content.indexOf(searchText, index + step);
  }

  if (searchFrom === 0) return null;

  index = content.indexOf(searchText, 0);
  while (index !== -1 && index < searchFrom) {
    const end = index + searchText.length;
    if (!rangesOverlap(index, end, selectedRanges)) {
      return { start: index, end };
    }
    index = content.indexOf(searchText, index + step);
  }

  return null;
}

function findPreviousAvailableOccurrence({
  content,
  searchText,
  searchFrom,
  selectedRanges,
}: {
  content: string;
  searchText: string;
  searchFrom: number;
  selectedRanges: OccurrenceRange[];
}): OccurrenceRange | null {
  let index = searchFrom <= 0 ? -1 : content.lastIndexOf(searchText, searchFrom - 1);

  while (index !== -1) {
    const end = index + searchText.length;
    if (!rangesOverlap(index, end, selectedRanges)) {
      return { start: index, end };
    }
    index = content.lastIndexOf(searchText, index - 1);
  }

  if (searchFrom >= content.length) return null;

  index = content.lastIndexOf(searchText);
  while (index !== -1 && index >= searchFrom) {
    const end = index + searchText.length;
    if (!rangesOverlap(index, end, selectedRanges)) {
      return { start: index, end };
    }
    index = content.lastIndexOf(searchText, index - 1);
  }

  return null;
}

export function resolveNextOccurrenceSelection({
  content,
  cursorOffset,
  selectionStart,
  selectionEnd,
}: ResolveNextOccurrenceOptions): OccurrenceRange | null {
  if (content.length === 0) return null;

  const selectedRange =
    selectionStart !== undefined && selectionEnd !== undefined
      ? normalizeRange(selectionStart, selectionEnd)
      : null;

  if (!selectedRange) {
    return getWordRangeAtOffset(content, cursorOffset);
  }

  const searchText = content.slice(selectedRange.start, selectedRange.end);
  if (!searchText) return null;

  const findFrom = (offset: number) => {
    const matchStart = content.indexOf(searchText, offset);
    return matchStart === -1 ? null : { start: matchStart, end: matchStart + searchText.length };
  };

  const nextMatch = findFrom(selectedRange.end) ?? findFrom(0);
  if (!nextMatch) return null;
  if (nextMatch.start === selectedRange.start && nextMatch.end === selectedRange.end) return null;

  return nextMatch;
}

export function resolvePreviousOccurrenceSelection({
  content,
  cursorOffset,
  selectionStart,
  selectionEnd,
}: ResolveNextOccurrenceOptions): OccurrenceRange | null {
  if (content.length === 0) return null;

  const selectedRange =
    selectionStart !== undefined && selectionEnd !== undefined
      ? normalizeRange(selectionStart, selectionEnd)
      : null;

  if (!selectedRange) {
    return getWordRangeAtOffset(content, cursorOffset);
  }

  const searchText = content.slice(selectedRange.start, selectedRange.end);
  if (!searchText) return null;

  const previousMatch =
    findPreviousAvailableOccurrence({
      content,
      searchText,
      searchFrom: selectedRange.start,
      selectedRanges: [selectedRange],
    }) ??
    findPreviousAvailableOccurrence({
      content,
      searchText,
      searchFrom: content.length,
      selectedRanges: [selectedRange],
    });
  if (!previousMatch) return null;
  if (previousMatch.start === selectedRange.start && previousMatch.end === selectedRange.end) {
    return null;
  }

  return previousMatch;
}

export function resolveSelectNextOccurrenceAction({
  content,
  cursorOffset,
  currentSelection,
  selectedRanges = [],
}: ResolveSelectNextOccurrenceActionOptions): SelectNextOccurrenceAction | null {
  if (content.length === 0) return null;

  const normalizedSelectedRanges = selectedRanges
    .map(normalizeOccurrenceRange)
    .filter((range): range is OccurrenceRange => !!range)
    .sort((a, b) => a.start - b.start);

  if (normalizedSelectedRanges.length === 0) {
    const normalizedCurrentSelection = currentSelection
      ? normalizeOccurrenceRange(currentSelection)
      : null;

    if (!normalizedCurrentSelection) {
      const wordRange = getWordRangeAtOffset(content, cursorOffset);
      return wordRange ? { type: "select-initial", range: wordRange } : null;
    }

    normalizedSelectedRanges.push(normalizedCurrentSelection);
  }

  const searchRange = normalizedSelectedRanges[0];
  if (!searchRange) return null;

  const searchText = content.slice(searchRange.start, searchRange.end);
  if (!searchText) return null;

  const searchFrom = normalizedSelectedRanges.reduce(
    (maxOffset, range) => Math.max(maxOffset, range.end),
    0,
  );
  const nextRange = findNextAvailableOccurrence({
    content,
    searchText,
    searchFrom,
    selectedRanges: normalizedSelectedRanges,
  });
  if (!nextRange) return null;

  return {
    type: "add-next",
    searchRange,
    nextRange,
  };
}

export function resolveSelectPreviousOccurrenceAction({
  content,
  cursorOffset,
  currentSelection,
  selectedRanges = [],
}: ResolveSelectNextOccurrenceActionOptions): SelectOccurrenceAction | null {
  if (content.length === 0) return null;

  const normalizedSelectedRanges = selectedRanges
    .map(normalizeOccurrenceRange)
    .filter((range): range is OccurrenceRange => !!range)
    .sort((a, b) => a.start - b.start);

  if (normalizedSelectedRanges.length === 0) {
    const normalizedCurrentSelection = currentSelection
      ? normalizeOccurrenceRange(currentSelection)
      : null;

    if (!normalizedCurrentSelection) {
      const wordRange = getWordRangeAtOffset(content, cursorOffset);
      return wordRange ? { type: "select-initial", range: wordRange } : null;
    }

    normalizedSelectedRanges.push(normalizedCurrentSelection);
  }

  const searchRange = normalizedSelectedRanges[0];
  if (!searchRange) return null;

  const searchText = content.slice(searchRange.start, searchRange.end);
  if (!searchText) return null;

  const searchFrom = normalizedSelectedRanges.reduce(
    (minOffset, range) => Math.min(minOffset, range.start),
    content.length,
  );
  const previousRange = findPreviousAvailableOccurrence({
    content,
    searchText,
    searchFrom,
    selectedRanges: normalizedSelectedRanges,
  });
  if (!previousRange) return null;

  return {
    type: "add-next",
    searchRange,
    nextRange: previousRange,
  };
}

export function resolveAllOccurrenceRanges({
  content,
  cursorOffset,
  selectionStart,
  selectionEnd,
  maxOccurrences = 10_000,
}: ResolveAllOccurrencesOptions): OccurrenceRange[] {
  if (content.length === 0) return [];

  const selectedRange =
    selectionStart !== undefined && selectionEnd !== undefined
      ? normalizeRange(selectionStart, selectionEnd)
      : null;
  const searchRange = selectedRange ?? getWordRangeAtOffset(content, cursorOffset);
  if (!searchRange) return [];

  const searchText = content.slice(searchRange.start, searchRange.end);
  if (!searchText) return [];

  const occurrences: OccurrenceRange[] = [];
  const safeMaxOccurrences = Math.max(1, Math.floor(maxOccurrences));
  let index = content.indexOf(searchText, 0);
  const step = Math.max(searchText.length, 1);

  while (index !== -1 && occurrences.length < safeMaxOccurrences) {
    occurrences.push({ start: index, end: index + searchText.length });
    index = content.indexOf(searchText, index + step);
  }

  return occurrences;
}
