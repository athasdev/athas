import type { SearchMatch } from "@/features/file-search/api/file-search-api";
import { buildFileSearchResult } from "../utils/content-search-results";
import type { SearchTask, SearchTaskResult } from "./search-worker-protocol";
import { filterProviderSearchEntries } from "./provider-ignore-matching";

function lineColumnToOffset(content: string, line: number, column: number): number {
  if (!Number.isSafeInteger(line) || !Number.isSafeInteger(column) || line < 1 || column < 1)
    throw new Error("The search match position is invalid. Search again before replacing.");
  const lines = content.split(/\r\n|\r|\n/);
  if (line > lines.length) return content.length;
  let offset = 0;
  for (let index = 0; index < line - 1; index++) {
    offset += lines[index].length;
    if (content[offset] === "\r" && content[offset + 1] === "\n") offset += 2;
    else offset++;
  }
  return offset + Math.min(column - 1, lines[line - 1].length);
}

function validateSearchSnapshot(
  filePath: string,
  content: string,
  expectedMatches: SearchMatch[] | undefined,
  regex: RegExp,
) {
  if (!expectedMatches) return;
  const lines = content.split(/\r\n|\r|\n/);
  const lineOffsets: number[] = [];
  let nextOffset = 0;
  for (const line of lines) {
    lineOffsets.push(nextOffset);
    nextOffset += line.length;
    nextOffset += content[nextOffset] === "\r" && content[nextOffset + 1] === "\n" ? 2 : 1;
  }
  const expected = expectedMatches
    .flatMap((match) => {
      if (lines[match.line_number - 1] !== match.line_content.replace(/\r$/, ""))
        throw new Error(`${filePath} changed since the search. Search again before replacing.`);
      const offset = lineOffsets[match.line_number - 1];
      const ranges = match.match_ranges?.length
        ? match.match_ranges
        : [{ start: match.column_start, end: match.column_end }];
      return ranges.map((range) => ({ start: offset + range.start, end: offset + range.end }));
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const actual = [...content.matchAll(regex)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
  regex.lastIndex = 0;
  if (
    expected.length !== actual.length ||
    expected.some(
      (range, index) => range.start !== actual[index].start || range.end !== actual[index].end,
    )
  )
    throw new Error(
      "The search results and replacement expression differ. Refresh the search or adjust the expression before replacing.",
    );
}

export function executeSearchTask(task: SearchTask): SearchTaskResult {
  if (task.kind === "filter") return filterProviderSearchEntries(task);
  const regex = new RegExp(task.pattern, task.flags);
  if (task.kind === "search")
    return buildFileSearchResult(task.filePath, task.content, regex, task.contextLines);
  validateSearchSnapshot(task.filePath, task.content, task.expectedMatches, regex);
  if (task.target) {
    const targetOffset = lineColumnToOffset(task.content, task.target.line, task.target.column);
    if (
      task.target.expectedLine !== undefined &&
      task.content.split(/\r\n|\r|\n/)[task.target.line - 1] !==
        task.target.expectedLine.replace(/\r$/, "")
    )
      throw new Error("The selected search match changed. Search again before replacing.");
    let selectedMatch: RegExpExecArray | null = null;
    let match = regex.exec(task.content);

    while (match) {
      if (match.index === targetOffset) {
        selectedMatch = match;
        break;
      }
      if (match.index > targetOffset) break;
      if (match.index === regex.lastIndex) regex.lastIndex++;
      match = regex.exec(task.content);
    }

    if (!selectedMatch) return { content: task.content, count: 0 };

    const nextContent = task.useRegex
      ? (() => {
          const singleMatch = new RegExp(regex.source, regex.flags.replace(/g/g, "") + "y");
          singleMatch.lastIndex = selectedMatch.index;
          return task.content.replace(singleMatch, task.replacement);
        })()
      : task.content.slice(0, selectedMatch.index) +
        task.replacement +
        task.content.slice(selectedMatch.index + selectedMatch[0].length);
    return { content: nextContent, count: nextContent === task.content ? 0 : 1 };
  }
  let count = 0;
  let match = regex.exec(task.content);
  while (match) {
    count++;
    if (match.index === regex.lastIndex) regex.lastIndex++;
    match = regex.exec(task.content);
  }
  regex.lastIndex = 0;
  const content = task.useRegex
    ? task.content.replace(regex, task.replacement)
    : task.content.replace(regex, () => task.replacement);
  return { content, count: content === task.content ? 0 : count };
}
