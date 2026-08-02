import {
  buildSearchRegex,
  findAllMatches,
  type SearchOptions,
} from "@/features/editor/utils/search";
import type { MultiFileDiff } from "../types/git-diff.types";
import type { GitDiff } from "../types/git.types";

export interface MultiDiffSearchMatch {
  sectionKey: string;
  fileIndex: number;
  lineIndex: number;
  start: number;
  end: number;
}

export function getMultiDiffSectionKey(
  multiDiff: MultiFileDiff,
  diff: GitDiff,
  index: number,
): string {
  return multiDiff.fileKeys?.[index] ?? `${diff.file_path}:${index}`;
}

export function findMultiDiffMatches(
  multiDiff: MultiFileDiff,
  query: string,
  options: SearchOptions,
): MultiDiffSearchMatch[] {
  const regex = buildSearchRegex(query, options);
  if (!regex) return [];

  return multiDiff.files.flatMap((diff, fileIndex) => {
    const sectionKey = getMultiDiffSectionKey(multiDiff, diff, fileIndex);

    return diff.lines.flatMap((line, lineIndex) => {
      if (line.line_type === "header") return [];

      return findAllMatches(line.content, regex).map((match) => ({
        sectionKey,
        fileIndex,
        lineIndex,
        start: match.start,
        end: match.end,
      }));
    });
  });
}
