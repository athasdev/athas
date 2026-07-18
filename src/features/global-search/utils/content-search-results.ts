import type {
  FileSearchResult,
  SearchMatch,
  SearchMatchRange,
} from "@/features/file-search/lib/file-search-api";

function findLineMatchRanges(line: string, regex: RegExp): SearchMatchRange[] {
  const ranges: SearchMatchRange[] = [];
  regex.lastIndex = 0;

  let match = regex.exec(line);
  while (match) {
    ranges.push({
      start: match.index,
      end: match.index + match[0].length,
    });
    if (match.index === regex.lastIndex) regex.lastIndex++;
    match = regex.exec(line);
  }

  return ranges;
}

export function buildFileSearchResult(
  filePath: string,
  content: string,
  regex: RegExp,
  contextLines: number,
): FileSearchResult | null {
  if (content.includes("\0")) return null;

  const lines = content.split("\n");
  const matches: SearchMatch[] = [];

  lines.forEach((line, index) => {
    const ranges = findLineMatchRanges(line, regex);
    if (ranges.length === 0) return;

    const lineNumber = index + 1;
    matches.push({
      line_number: lineNumber,
      line_content: line,
      column_start: ranges[0]?.start ?? 0,
      column_end: ranges[0]?.end ?? 0,
      match_ranges: ranges,
      context_before: lines.slice(Math.max(0, index - contextLines), index),
      context_after: lines.slice(index + 1, index + 1 + contextLines),
    });
  });

  if (matches.length === 0) return null;

  return {
    file_path: filePath,
    matches,
    total_matches: matches.length,
  };
}

export function mergeSearchResults(
  previousResults: FileSearchResult[],
  nextResults: FileSearchResult[],
): FileSearchResult[] {
  if (previousResults.length === 0) return nextResults;
  if (nextResults.length === 0) return previousResults;

  const resultsByPath = new Map(previousResults.map((result) => [result.file_path, result]));

  for (const result of nextResults) {
    const existing = resultsByPath.get(result.file_path);
    if (!existing) {
      resultsByPath.set(result.file_path, result);
      continue;
    }

    resultsByPath.set(result.file_path, {
      ...existing,
      matches: [...existing.matches, ...result.matches],
      total_matches: existing.total_matches + result.total_matches,
    });
  }

  return Array.from(resultsByPath.values());
}
