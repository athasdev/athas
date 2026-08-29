import type { MultiFileDiff } from "@/features/git/types/git-diff.types";
import type { GitDiff, GitDiffLine } from "@/features/git/types/git.types";
import { groupLinesIntoHunks, parseDiffHunkRange } from "@/features/git/utils/git-diff-helpers";
import type { ReviewHunkSummary } from "../types/review.types";

export interface ReviewHunk {
  id: string;
  filePath: string;
  fileKey: string;
  header: GitDiffLine;
  lines: GitDiffLine[];
  additions: number;
  deletions: number;
  newStart: number | null;
  context: string | null;
  patch: string;
  fallbackSummary: ReviewHunkSummary;
  diff: GitDiff;
}

function stableHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function serializeLine(line: GitDiffLine): string {
  if (line.line_type === "added") return `+${line.content}`;
  if (line.line_type === "removed") return `-${line.content}`;
  if (line.line_type === "context") return ` ${line.content}`;
  return line.content;
}

function createFallbackSummary(
  filePath: string,
  header: GitDiffLine,
  lines: GitDiffLine[],
): ReviewHunkSummary {
  const range = parseDiffHunkRange(header.content);
  const fileName = filePath.split("/").pop() || filePath;
  const additions = lines.filter((line) => line.line_type === "added").length;
  const deletions = lines.filter((line) => line.line_type === "removed").length;
  const action =
    additions > 0 && deletions > 0 ? "Updates" : additions > 0 ? "Adds to" : "Removes from";
  const context = range?.context.replace(/^[}\s]+|[{\s]+$/g, "").trim();

  const subject = context && context.length <= 80 ? context : fileName;
  return {
    title: `${action} ${subject}`,
    description:
      additions > 0 && deletions > 0
        ? `Replaces existing logic with a new implementation in this part of ${fileName}.`
        : additions > 0
          ? `Introduces new behavior in this part of ${fileName}.`
          : `Removes existing behavior from this part of ${fileName}.`,
  };
}

export function createReviewHunks(multiDiff: MultiFileDiff): ReviewHunk[] {
  return multiDiff.files.flatMap((diff, fileIndex) => {
    if (diff.is_binary || diff.is_image) return [];
    const filePath = diff.new_path || diff.old_path || diff.file_path;
    const fileKey = multiDiff.fileKeys?.[fileIndex] ?? filePath;

    return groupLinesIntoHunks(diff.lines).map((hunk) => {
      const lines: GitDiffLine[] = hunk.lines.map((line) => ({
        line_type: line.line_type,
        content: line.content,
        old_line_number: line.old_line_number,
        new_line_number: line.new_line_number,
      }));
      const patch = [hunk.header, ...lines].map(serializeLine).join("\n");
      const id = `${fileKey}:${stableHash(`${filePath}\n${patch}`)}`;
      const additions = lines.filter((line) => line.line_type === "added").length;
      const deletions = lines.filter((line) => line.line_type === "removed").length;
      const range = parseDiffHunkRange(hunk.header.content);

      return {
        id,
        filePath,
        fileKey,
        header: hunk.header,
        lines,
        additions,
        deletions,
        newStart: range?.newStart ?? null,
        context: range?.context || null,
        patch,
        fallbackSummary: createFallbackSummary(filePath, hunk.header, lines),
        diff: {
          ...diff,
          lines: [hunk.header, ...lines],
          additions,
          deletions,
          raw_patch: patch,
        },
      };
    });
  });
}
