import { getWordRangeAtOffset, isWordCharCode } from "./word-navigation";

export interface WordHighlightRange {
  start: number;
  end: number;
  isCurrent: boolean;
}

export interface FindWordHighlightRangesOptions {
  content: string;
  cursorOffset: number;
  lineOffsets: readonly number[];
  viewportRange?: { startLine: number; endLine: number };
  minWordLength?: number;
  maxMatches?: number;
}

const DEFAULT_MIN_WORD_LENGTH = 2;
const DEFAULT_MAX_MATCHES = 1000;

function getLineEnd(content: string, lineOffsets: readonly number[], lineIndex: number): number {
  const lineStart = lineOffsets[lineIndex] ?? content.length;
  const nextLineStart = lineOffsets[lineIndex + 1] ?? content.length;
  let lineEnd = Math.max(lineStart, nextLineStart);

  if (lineEnd > lineStart && content.charCodeAt(lineEnd - 1) === 10) lineEnd--;
  if (lineEnd > lineStart && content.charCodeAt(lineEnd - 1) === 13) lineEnd--;

  return lineEnd;
}

function hasWordBoundary(content: string, start: number, end: number): boolean {
  const before = start > 0 ? content.charCodeAt(start - 1) : Number.NaN;
  const after = end < content.length ? content.charCodeAt(end) : Number.NaN;

  return !isWordCharCode(before) && !isWordCharCode(after);
}

export function findWordHighlightRanges({
  content,
  cursorOffset,
  lineOffsets,
  viewportRange,
  minWordLength = DEFAULT_MIN_WORD_LENGTH,
  maxMatches = DEFAULT_MAX_MATCHES,
}: FindWordHighlightRangesOptions): WordHighlightRange[] {
  if (content.length === 0 || lineOffsets.length === 0) return [];

  const currentWord = getWordRangeAtOffset(content, cursorOffset);
  if (!currentWord) return [];

  const word = content.slice(currentWord.start, currentWord.end);
  if (word.length < minWordLength) return [];

  const startLine = Math.max(0, Math.min(viewportRange?.startLine ?? 0, lineOffsets.length));
  const endLine = Math.max(
    startLine,
    Math.min(viewportRange?.endLine ?? lineOffsets.length, lineOffsets.length),
  );
  const ranges: WordHighlightRange[] = [];

  for (let lineIndex = startLine; lineIndex < endLine; lineIndex++) {
    const lineStart = lineOffsets[lineIndex] ?? content.length;
    const lineEnd = getLineEnd(content, lineOffsets, lineIndex);
    const lineText = content.slice(lineStart, lineEnd);
    let searchFrom = 0;

    while (searchFrom + word.length <= lineText.length) {
      const matchColumn = lineText.indexOf(word, searchFrom);
      if (matchColumn === -1) break;

      const matchStart = lineStart + matchColumn;
      const matchEnd = matchStart + word.length;
      if (hasWordBoundary(content, matchStart, matchEnd)) {
        ranges.push({
          start: matchStart,
          end: matchEnd,
          isCurrent: matchStart === currentWord.start && matchEnd === currentWord.end,
        });

        if (ranges.length >= maxMatches) return ranges;
      }

      searchFrom = matchColumn + word.length;
    }
  }

  return ranges;
}
