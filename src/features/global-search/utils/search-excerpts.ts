import type { FileSearchResult, SearchMatch } from "../lib/rust-api/search";
import { getBaseName, getDirectoryPath, getRelativePath } from "@/utils/path-helpers";

export interface SearchExcerptHighlight {
  start: number;
  end: number;
  itemKey: string;
}

export interface SearchExcerptMatch {
  itemKey: string;
  filePath: string;
  targetLine: number;
  targetColumn: number;
  highlightIndexes: number[];
}

export interface SearchExcerpt {
  id: string;
  filePath: string;
  displayPath: string;
  fileName: string;
  directoryPath: string;
  content: string;
  lineNumberMap: Array<number | null>;
  matches: SearchExcerptMatch[];
  matchCount: number;
  highlights: SearchExcerptHighlight[];
}

interface BuildSearchExcerptsOptions {
  contextLinesByFile?: Record<string, number>;
  sourceContentByPath?: Record<string, string>;
  prioritizedFilePath?: string | null;
  prioritizedMatchLimit?: number;
}

function fallbackRange(match: SearchMatch): { start: number; end: number } {
  return {
    start: match.column_start,
    end: Math.max(match.column_end, match.column_start + 1),
  };
}

function matchRanges(match: SearchMatch): Array<{ start: number; end: number }> {
  const ranges =
    match.match_ranges && match.match_ranges.length > 0
      ? match.match_ranges
      : [fallbackRange(match)];

  return ranges
    .map((range) => ({
      start: range.start,
      end: Math.max(range.end, range.start + 1),
    }))
    .filter((range) => range.end > range.start);
}

function buildSearchExcerpt(
  result: FileSearchResult,
  rootFolderPath: string | null | undefined,
  matchLimit: number,
  options: BuildSearchExcerptsOptions,
): SearchExcerpt | null {
  const displayPath = getRelativePath(result.file_path, rootFolderPath);
  const fileName = getBaseName(result.file_path, result.file_path);
  const directoryPath = getDirectoryPath(result.file_path, rootFolderPath);
  const sourceContent = options.sourceContentByPath?.[result.file_path];
  const sourceLines = sourceContent?.split("\n");
  const expandedContextLines = options.contextLinesByFile?.[result.file_path];
  const lineTextByNumber = new Map<number, string>();
  const contextRanges: Array<{ start: number; end: number }> = [];
  const includedMatches: Array<{
    itemKey: string;
    match: SearchMatch;
    ranges: SearchExcerptHighlight[];
  }> = [];

  for (let index = 0; index < result.matches.length && index < matchLimit; index++) {
    const match = result.matches[index];
    if (!match) continue;

    const contextBefore = match.context_before ?? [];
    const contextAfter = match.context_after ?? [];
    const contextBeforeLength =
      sourceLines && expandedContextLines !== undefined
        ? Math.min(expandedContextLines, Math.max(0, match.line_number - 1))
        : contextBefore.length;
    const contextAfterLength =
      sourceLines && expandedContextLines !== undefined
        ? Math.min(expandedContextLines, Math.max(0, sourceLines.length - match.line_number))
        : contextAfter.length;
    const startLine = Math.max(1, match.line_number - contextBeforeLength);
    const endLine = match.line_number + contextAfterLength;
    const itemKey = `${result.file_path}:${match.line_number}:${index}`;

    if (sourceLines) {
      for (let lineNumber = startLine; lineNumber <= endLine; lineNumber++) {
        lineTextByNumber.set(lineNumber, sourceLines[lineNumber - 1] ?? "");
      }
    } else {
      contextBefore.forEach((line, beforeIndex) => {
        lineTextByNumber.set(startLine + beforeIndex, line);
      });
      lineTextByNumber.set(match.line_number, match.line_content);
      contextAfter.forEach((line, afterIndex) => {
        lineTextByNumber.set(match.line_number + afterIndex + 1, line);
      });
    }

    contextRanges.push({ start: startLine, end: endLine });
    includedMatches.push({
      itemKey,
      match,
      ranges: matchRanges(match).map((range) => ({ ...range, itemKey })),
    });
  }

  if (includedMatches.length === 0) return null;

  const mergedRanges = contextRanges
    .sort((left, right) => left.start - right.start)
    .reduce<Array<{ start: number; end: number }>>((ranges, nextRange) => {
      const previous = ranges[ranges.length - 1];
      if (previous && nextRange.start <= previous.end + 1) {
        previous.end = Math.max(previous.end, nextRange.end);
      } else {
        ranges.push({ ...nextRange });
      }
      return ranges;
    }, []);
  const lines: string[] = [];
  const lineNumberMap: Array<number | null> = [];

  mergedRanges.forEach((range, rangeIndex) => {
    if (rangeIndex > 0) {
      lines.push("...");
      lineNumberMap.push(null);
    }

    for (let lineNumber = range.start; lineNumber <= range.end; lineNumber++) {
      lines.push(lineTextByNumber.get(lineNumber) ?? "");
      lineNumberMap.push(lineNumber);
    }
  });

  const lineIndexByNumber = new Map<number, number>();
  lineNumberMap.forEach((lineNumber, index) => {
    if (lineNumber !== null && !lineIndexByNumber.has(lineNumber)) {
      lineIndexByNumber.set(lineNumber, index);
    }
  });
  const lineOffsets: number[] = [];
  let nextLineOffset = 0;
  for (const line of lines) {
    lineOffsets.push(nextLineOffset);
    nextLineOffset += line.length + 1;
  }

  const highlights: SearchExcerptHighlight[] = [];
  const matches: SearchExcerptMatch[] = includedMatches.map(({ itemKey, match, ranges }) => {
    const lineIndex = lineIndexByNumber.get(match.line_number);
    const highlightIndexes: number[] = [];

    if (lineIndex !== undefined) {
      const matchLineOffset = lineOffsets[lineIndex] ?? 0;
      for (const range of ranges) {
        highlightIndexes.push(highlights.length);
        highlights.push({
          itemKey,
          start: matchLineOffset + range.start,
          end: matchLineOffset + range.end,
        });
      }
    }

    return {
      itemKey,
      filePath: result.file_path,
      targetLine: match.line_number,
      targetColumn: match.column_start + 1,
      highlightIndexes,
    };
  });

  return {
    id: result.file_path,
    filePath: result.file_path,
    displayPath,
    fileName,
    directoryPath,
    content: lines.join("\n"),
    lineNumberMap,
    matches,
    matchCount: result.total_matches,
    highlights,
  };
}

export function buildSearchExcerpts(
  results: FileSearchResult[],
  rootFolderPath: string | null | undefined,
  limit: number,
  options: BuildSearchExcerptsOptions = {},
): SearchExcerpt[] {
  const excerpts: SearchExcerpt[] = [];
  const includedPaths = new Set<string>();
  let remainingMatchLimit = Math.max(0, limit);

  for (const result of results) {
    if (remainingMatchLimit === 0) break;

    const matchLimit =
      result.file_path === options.prioritizedFilePath
        ? Math.max(remainingMatchLimit, options.prioritizedMatchLimit ?? 40)
        : remainingMatchLimit;
    const excerpt = buildSearchExcerpt(result, rootFolderPath, matchLimit, options);
    if (!excerpt) continue;

    excerpts.push(excerpt);
    includedPaths.add(result.file_path);
    remainingMatchLimit = Math.max(0, remainingMatchLimit - excerpt.matches.length);
  }

  const prioritizedFilePath = options.prioritizedFilePath;
  if (prioritizedFilePath && !includedPaths.has(prioritizedFilePath)) {
    const result = results.find((candidate) => candidate.file_path === prioritizedFilePath);
    if (result) {
      const excerpt = buildSearchExcerpt(
        result,
        rootFolderPath,
        options.prioritizedMatchLimit ?? 40,
        options,
      );
      if (excerpt) excerpts.push(excerpt);
    }
  }

  return excerpts;
}
