import type { GitDiff, GitDiffLine } from "@/features/git/types/git-types";
import { getBaseName } from "@/utils/path-helpers";

const MAX_EXACT_DIFF_CELLS = 500_000;

interface LineChange {
  type: "context" | "removed" | "added";
  content: string;
  oldLine?: number;
  newLine?: number;
}

function splitLines(content: string): string[] {
  if (!content) return [];
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function createWholeFileDiff(oldLines: string[], newLines: string[]): LineChange[] {
  return [
    ...oldLines.map((content, index) => ({
      type: "removed" as const,
      content,
      oldLine: index + 1,
    })),
    ...newLines.map((content, index) => ({
      type: "added" as const,
      content,
      newLine: index + 1,
    })),
  ];
}

function createLineChanges(oldLines: string[], newLines: string[]): LineChange[] {
  if (oldLines.length * newLines.length > MAX_EXACT_DIFF_CELLS) {
    return createWholeFileDiff(oldLines, newLines);
  }

  const lcs: number[][] = Array.from({ length: oldLines.length + 1 }, () =>
    Array(newLines.length + 1).fill(0),
  );

  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex--) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex--) {
      lcs[oldIndex][newIndex] =
        oldLines[oldIndex] === newLines[newIndex]
          ? lcs[oldIndex + 1][newIndex + 1] + 1
          : Math.max(lcs[oldIndex + 1][newIndex], lcs[oldIndex][newIndex + 1]);
    }
  }

  const changes: LineChange[] = [];
  let oldIndex = 0;
  let newIndex = 0;

  while (oldIndex < oldLines.length && newIndex < newLines.length) {
    if (oldLines[oldIndex] === newLines[newIndex]) {
      changes.push({
        type: "context",
        content: oldLines[oldIndex],
        oldLine: oldIndex + 1,
        newLine: newIndex + 1,
      });
      oldIndex++;
      newIndex++;
    } else if (lcs[oldIndex + 1][newIndex] >= lcs[oldIndex][newIndex + 1]) {
      changes.push({
        type: "removed",
        content: oldLines[oldIndex],
        oldLine: oldIndex + 1,
      });
      oldIndex++;
    } else {
      changes.push({
        type: "added",
        content: newLines[newIndex],
        newLine: newIndex + 1,
      });
      newIndex++;
    }
  }

  while (oldIndex < oldLines.length) {
    changes.push({
      type: "removed",
      content: oldLines[oldIndex],
      oldLine: oldIndex + 1,
    });
    oldIndex++;
  }

  while (newIndex < newLines.length) {
    changes.push({
      type: "added",
      content: newLines[newIndex],
      newLine: newIndex + 1,
    });
    newIndex++;
  }

  return changes;
}

function toDiffLines(
  changes: LineChange[],
  oldLineCount: number,
  newLineCount: number,
): GitDiffLine[] {
  if (changes.length === 0) return [];

  return [
    {
      line_type: "header",
      content: `@@ -1,${oldLineCount} +1,${newLineCount} @@`,
    },
    ...changes.map((change) => ({
      line_type: change.type,
      content: change.content,
      old_line_number: change.oldLine,
      new_line_number: change.newLine,
    })),
  ];
}

export function createLocalHistoryDiff(params: {
  filePath: string;
  oldContent: string;
  newContent: string;
}): GitDiff {
  const oldLines = splitLines(params.oldContent);
  const newLines = splitLines(params.newContent);
  const changes = createLineChanges(oldLines, newLines);
  const fileName = getBaseName(params.filePath, params.filePath);

  return {
    file_path: fileName,
    old_path: fileName,
    new_path: fileName,
    is_new: oldLines.length === 0,
    is_deleted: newLines.length === 0,
    is_renamed: false,
    is_binary: false,
    is_image: false,
    lines: toDiffLines(changes, oldLines.length, newLines.length),
  };
}
