import type { GitDiff, GitDiffLine } from "@/features/git/types/git.types";
import { getBaseName } from "@/utils/path-helpers";

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

interface LineAnchor {
  oldIndex: number;
  newIndex: number;
}

function countLines(lines: string[], start: number, end: number): Map<string, number> {
  const counts = new Map<string, number>();
  for (let index = start; index < end; index++) {
    counts.set(lines[index], (counts.get(lines[index]) ?? 0) + 1);
  }
  return counts;
}

function findPatienceAnchors(
  oldLines: string[],
  oldStart: number,
  oldEnd: number,
  newLines: string[],
  newStart: number,
  newEnd: number,
): LineAnchor[] {
  const oldCounts = countLines(oldLines, oldStart, oldEnd);
  const newCounts = countLines(newLines, newStart, newEnd);
  const newUniqueIndexes = new Map<string, number>();

  for (let index = newStart; index < newEnd; index++) {
    const line = newLines[index];
    if (oldCounts.get(line) === 1 && newCounts.get(line) === 1) {
      newUniqueIndexes.set(line, index);
    }
  }

  const candidates: LineAnchor[] = [];
  for (let index = oldStart; index < oldEnd; index++) {
    const line = oldLines[index];
    const newIndex = newUniqueIndexes.get(line);
    if (newIndex !== undefined) {
      candidates.push({ oldIndex: index, newIndex });
    }
  }

  return longestIncreasingAnchors(candidates);
}

function longestIncreasingAnchors(candidates: LineAnchor[]): LineAnchor[] {
  if (candidates.length <= 1) return candidates;

  const tails: number[] = [];
  const predecessors = Array.from({ length: candidates.length }, () => -1);

  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    let low = 0;
    let high = tails.length;

    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      const tail = candidates[tails[mid]];
      if (tail.newIndex < candidate.newIndex) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }

    if (low > 0) {
      predecessors[index] = tails[low - 1];
    }
    tails[low] = index;
  }

  const anchors: LineAnchor[] = [];
  let cursor = tails[tails.length - 1];
  while (cursor !== -1) {
    anchors.push(candidates[cursor]);
    cursor = predecessors[cursor];
  }
  return anchors.reverse();
}

function createAddedChanges(newLines: string[], start: number, end: number): LineChange[] {
  return newLines.slice(start, end).map((content, index) => ({
    type: "added" as const,
    content,
    newLine: start + index + 1,
  }));
}

function createRemovedChanges(oldLines: string[], start: number, end: number): LineChange[] {
  return oldLines.slice(start, end).map((content, index) => ({
    type: "removed" as const,
    content,
    oldLine: start + index + 1,
  }));
}

function createContextChange(oldLines: string[], oldIndex: number, newIndex: number): LineChange {
  return {
    type: "context",
    content: oldLines[oldIndex],
    oldLine: oldIndex + 1,
    newLine: newIndex + 1,
  };
}

function diffLineRange(
  oldLines: string[],
  oldStart: number,
  oldEnd: number,
  newLines: string[],
  newStart: number,
  newEnd: number,
): LineChange[] {
  const changes: LineChange[] = [];
  const suffix: LineChange[] = [];

  while (oldStart < oldEnd && newStart < newEnd && oldLines[oldStart] === newLines[newStart]) {
    changes.push(createContextChange(oldLines, oldStart, newStart));
    oldStart++;
    newStart++;
  }

  while (oldStart < oldEnd && newStart < newEnd && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
    oldEnd--;
    newEnd--;
    suffix.unshift(createContextChange(oldLines, oldEnd, newEnd));
  }

  if (oldStart >= oldEnd) {
    return [...changes, ...createAddedChanges(newLines, newStart, newEnd), ...suffix];
  }

  if (newStart >= newEnd) {
    return [...changes, ...createRemovedChanges(oldLines, oldStart, oldEnd), ...suffix];
  }

  const anchors = findPatienceAnchors(oldLines, oldStart, oldEnd, newLines, newStart, newEnd);
  if (anchors.length === 0) {
    return [
      ...changes,
      ...createRemovedChanges(oldLines, oldStart, oldEnd),
      ...createAddedChanges(newLines, newStart, newEnd),
      ...suffix,
    ];
  }

  let oldCursor = oldStart;
  let newCursor = newStart;
  for (const anchor of anchors) {
    changes.push(
      ...diffLineRange(oldLines, oldCursor, anchor.oldIndex, newLines, newCursor, anchor.newIndex),
    );
    changes.push(createContextChange(oldLines, anchor.oldIndex, anchor.newIndex));
    oldCursor = anchor.oldIndex + 1;
    newCursor = anchor.newIndex + 1;
  }

  changes.push(...diffLineRange(oldLines, oldCursor, oldEnd, newLines, newCursor, newEnd));
  return [...changes, ...suffix];
}

function createLineChanges(oldLines: string[], newLines: string[]): LineChange[] {
  if (oldLines.length === 0 || newLines.length === 0) {
    return createWholeFileDiff(oldLines, newLines);
  }

  return diffLineRange(oldLines, 0, oldLines.length, newLines, 0, newLines.length);
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
