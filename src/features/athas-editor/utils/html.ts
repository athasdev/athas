/**
 * HTML escaping and rendering utilities
 */

export interface Token {
  start: number;
  end: number;
  class_name: string;
}

/**
 * Line offset cache for fast line-to-offset conversions
 */
interface LineOffsetCache {
  offsets: number[];
  content: string;
}

let lineOffsetCache: LineOffsetCache | null = null;
const INCREMENTAL_LINE_OFFSET_EDIT_THRESHOLD = 1000;

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

function findLineIndexForOffset(offsets: number[], offset: number): number {
  let low = 0;
  let high = Math.max(0, offsets.length - 1);
  let line = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const lineOffset = offsets[mid] ?? 0;

    if (lineOffset <= offset) {
      line = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return line;
}

export function applyIncrementalLineOffsetEdit(
  previousContent: string,
  nextContent: string,
  previousOffsets: number[],
): number[] | null {
  if (previousContent === nextContent) {
    return previousOffsets;
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
    Math.max(removedLength, insertedLength) > INCREMENTAL_LINE_OFFSET_EDIT_THRESHOLD
  ) {
    return null;
  }

  const startLine = findLineIndexForOffset(previousOffsets, prefixLength);
  const endLine = findLineIndexForOffset(previousOffsets, previousEndOffset);
  const delta = nextContent.length - previousContent.length;
  const insertedText = nextContent.slice(prefixLength, nextEndOffset);
  const replacementOffsets = [previousOffsets[startLine] ?? 0];

  for (let index = 0; index < insertedText.length; index++) {
    if (insertedText.charCodeAt(index) === 10) {
      replacementOffsets.push(prefixLength + index + 1);
    }
  }

  return [
    ...previousOffsets.slice(0, startLine),
    ...replacementOffsets,
    ...previousOffsets.slice(endLine + 1).map((offset) => offset + delta),
  ];
}

/**
 * Normalize line endings to Unix style (\n)
 * This ensures consistent offset calculations across platforms
 */
export function normalizeLineEndings(content: string): string {
  if (!content.includes("\r")) return content;
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * Build a map of line numbers to their starting character offsets
 * This avoids repeated offset calculations during rendering
 * Exported for use in tokenizer and other utilities
 */
export function buildLineOffsetMap(content: string): number[] {
  // Normalize line endings first to ensure consistent offsets
  const normalizedContent = normalizeLineEndings(content);

  // Check cache first
  if (lineOffsetCache && lineOffsetCache.content === normalizedContent) {
    return lineOffsetCache.offsets;
  }

  if (lineOffsetCache) {
    const incrementalOffsets = applyIncrementalLineOffsetEdit(
      lineOffsetCache.content,
      normalizedContent,
      lineOffsetCache.offsets,
    );
    if (incrementalOffsets) {
      lineOffsetCache = { offsets: incrementalOffsets, content: normalizedContent };
      return incrementalOffsets;
    }
  }

  const offsets = [0];

  for (let index = 0; index < normalizedContent.length; index++) {
    if (normalizedContent.charCodeAt(index) === 10) {
      offsets.push(index + 1);
    }
  }

  // Cache the result
  lineOffsetCache = { offsets, content: normalizedContent };
  return offsets;
}
