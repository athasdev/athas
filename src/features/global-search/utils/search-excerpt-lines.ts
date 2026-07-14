import type { Token } from "@/features/editor/utils/html";
import { splitLines } from "@/features/editor/utils/lines";
import type { SearchExcerptHighlight } from "./search-excerpts";

export interface SearchExcerptTextSegment {
  startColumn: number;
  endColumn: number;
  text: string;
  tokenClassName?: string;
  highlightIndexes: number[];
}

export interface SearchExcerptRenderLine {
  text: string;
  segments: SearchExcerptTextSegment[];
}

interface IndexedHighlight extends SearchExcerptHighlight {
  index: number;
}

function clampRange(start: number, end: number, contentLength: number) {
  const clampedStart = Math.max(0, Math.min(contentLength, start));
  const clampedEnd = Math.max(clampedStart, Math.min(contentLength, end));
  return clampedEnd > clampedStart ? { start: clampedStart, end: clampedEnd } : null;
}

export function buildSearchExcerptRenderLines(
  content: string,
  tokens: readonly Token[],
  highlights: readonly SearchExcerptHighlight[],
): SearchExcerptRenderLine[] {
  const lines = splitLines(content);
  const normalizedTokens = tokens
    .map((token) => {
      const range = clampRange(token.start, token.end, content.length);
      return range ? { ...range, class_name: token.class_name } : null;
    })
    .filter((token): token is Token => token !== null)
    .sort((left, right) => left.start - right.start || right.end - left.end);
  const normalizedHighlights = highlights
    .map<IndexedHighlight | null>((highlight, index) => {
      const range = clampRange(highlight.start, highlight.end, content.length);
      return range ? { ...highlight, ...range, index } : null;
    })
    .filter((highlight): highlight is IndexedHighlight => highlight !== null);
  let lineOffset = 0;

  return lines.map((line) => {
    const lineEnd = lineOffset + line.length;
    const lineTokens = normalizedTokens.filter(
      (token) => token.start < lineEnd && token.end > lineOffset,
    );
    const lineHighlights = normalizedHighlights.filter(
      (highlight) => highlight.start < lineEnd && highlight.end > lineOffset,
    );
    const boundaries = new Set([0, line.length]);

    for (const token of lineTokens) {
      boundaries.add(Math.max(0, token.start - lineOffset));
      boundaries.add(Math.min(line.length, token.end - lineOffset));
    }
    for (const highlight of lineHighlights) {
      boundaries.add(Math.max(0, highlight.start - lineOffset));
      boundaries.add(Math.min(line.length, highlight.end - lineOffset));
    }

    const orderedBoundaries = Array.from(boundaries).sort((left, right) => left - right);
    const segments: SearchExcerptTextSegment[] = [];

    for (let index = 0; index < orderedBoundaries.length - 1; index++) {
      const startColumn = orderedBoundaries[index] ?? 0;
      const endColumn = orderedBoundaries[index + 1] ?? startColumn;
      if (endColumn <= startColumn) continue;

      const absoluteStart = lineOffset + startColumn;
      const absoluteEnd = lineOffset + endColumn;
      const token = lineTokens.find(
        (candidate) => candidate.start <= absoluteStart && candidate.end >= absoluteEnd,
      );
      const highlightIndexes = lineHighlights
        .filter((highlight) => highlight.start < absoluteEnd && highlight.end > absoluteStart)
        .map((highlight) => highlight.index);

      segments.push({
        startColumn,
        endColumn,
        text: line.slice(startColumn, endColumn),
        tokenClassName: token?.class_name,
        highlightIndexes,
      });
    }

    const result = { text: line, segments };
    lineOffset = lineEnd + 1;
    return result;
  });
}

export function findClosestTextColumn(
  text: string,
  targetWidth: number,
  measurePrefix: (text: string) => number,
) {
  if (targetWidth <= 0 || text.length === 0) return 0;

  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.floor((low + high + 1) / 2);
    if (measurePrefix(text.slice(0, middle)) <= targetWidth) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }

  if (low >= text.length) return text.length;
  const lowerWidth = measurePrefix(text.slice(0, low));
  const upperWidth = measurePrefix(text.slice(0, low + 1));
  return targetWidth - lowerWidth <= upperWidth - targetWidth ? low : low + 1;
}
