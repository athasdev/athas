import type { GitDiffLine } from "@/features/git/types/git.types";

export type LineDiffOpType = "context" | "added" | "removed";

export interface LineDiffOp {
  type: LineDiffOpType;
  content: string;
  /** 1-based line in the old text; absent on added lines. */
  oldLine?: number;
  /** 1-based line in the new text; absent on removed lines. */
  newLine?: number;
}

export interface LineDiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  ops: LineDiffOp[];
}

/**
 * Beyond these the Myers search is abandoned and the changed region is
 * reported as a wholesale replacement. Both bounds apply after the common
 * prefix and suffix have been trimmed, so they are only reached by genuinely
 * dissimilar files. The distance bound also caps the backtracking trace,
 * whose peak cost grows with its square.
 */
const MAX_COMPARED_LINES = 20_000;
const MAX_EDIT_DISTANCE = 2_000;

const DEFAULT_CONTEXT_LINES = 3;

function splitLines(text: string): string[] {
  return text.length > 0 ? text.split("\n") : [];
}

interface IndexOp {
  type: LineDiffOpType;
  oldIndex?: number;
  newIndex?: number;
}

/**
 * Greedy Myers diff with a backtracking trace. Returns null when the edit
 * distance exceeds `MAX_EDIT_DISTANCE`, leaving the caller to fall back.
 */
function myersDiff(oldLines: string[], newLines: string[]): IndexOp[] | null {
  const n = oldLines.length;
  const m = newLines.length;
  const maxDistance = Math.min(n + m, MAX_EDIT_DISTANCE);
  // `k` spans [-d, d] and the search reads k±1, so pad by one on each side.
  const offset = maxDistance + 1;
  const v = new Int32Array(2 * maxDistance + 3);
  const trace: Int32Array[] = [];

  for (let d = 0; d <= maxDistance; d += 1) {
    // Record V as it stands before this step; backtracking reads it back.
    trace.push(v.slice());

    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
        x = v[offset + k + 1];
      } else {
        x = v[offset + k - 1] + 1;
      }
      let y = x - k;

      while (x < n && y < m && oldLines[x] === newLines[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;

      if (x >= n && y >= m) return backtrack(trace, offset, n, m);
    }
  }

  return null;
}

function backtrack(trace: Int32Array[], offset: number, n: number, m: number): IndexOp[] {
  const ops: IndexOp[] = [];
  let x = n;
  let y = m;

  for (let d = trace.length - 1; d >= 0; d -= 1) {
    const v = trace[d];
    const k = x - y;

    let previousX = 0;
    let previousY = 0;
    if (d > 0) {
      const previousK =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? k + 1 : k - 1;
      previousX = v[offset + previousK];
      previousY = previousX - previousK;
    }

    while (x > previousX && y > previousY) {
      ops.push({ type: "context", oldIndex: x - 1, newIndex: y - 1 });
      x -= 1;
      y -= 1;
    }

    if (d === 0) break;

    if (x > previousX) {
      ops.push({ type: "removed", oldIndex: x - 1 });
      x -= 1;
    } else {
      ops.push({ type: "added", newIndex: y - 1 });
      y -= 1;
    }
  }

  ops.reverse();
  return ops;
}

function replaceWholesale(oldCount: number, newCount: number): IndexOp[] {
  const ops: IndexOp[] = [];
  for (let index = 0; index < oldCount; index += 1) {
    ops.push({ type: "removed", oldIndex: index });
  }
  for (let index = 0; index < newCount; index += 1) {
    ops.push({ type: "added", newIndex: index });
  }
  return ops;
}

/**
 * Line-level diff of two texts. Equal leading and trailing lines are matched
 * directly, so a one-line change in a large file yields one changed line
 * rather than a full rewrite.
 */
export function diffTextLines(oldText: string, newText: string): LineDiffOp[] {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);

  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length) {
    if (oldLines[prefix] !== newLines[prefix]) break;
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const oldMiddle = oldLines.slice(prefix, oldLines.length - suffix);
  const newMiddle = newLines.slice(prefix, newLines.length - suffix);

  const middle =
    oldMiddle.length + newMiddle.length > MAX_COMPARED_LINES
      ? replaceWholesale(oldMiddle.length, newMiddle.length)
      : (myersDiff(oldMiddle, newMiddle) ?? replaceWholesale(oldMiddle.length, newMiddle.length));

  const ops: LineDiffOp[] = [];

  for (let index = 0; index < prefix; index += 1) {
    ops.push({
      type: "context",
      content: oldLines[index],
      oldLine: index + 1,
      newLine: index + 1,
    });
  }

  for (const op of middle) {
    if (op.type === "removed") {
      const oldIndex = prefix + (op.oldIndex ?? 0);
      ops.push({ type: "removed", content: oldLines[oldIndex], oldLine: oldIndex + 1 });
      continue;
    }
    if (op.type === "added") {
      const newIndex = prefix + (op.newIndex ?? 0);
      ops.push({ type: "added", content: newLines[newIndex], newLine: newIndex + 1 });
      continue;
    }
    const oldIndex = prefix + (op.oldIndex ?? 0);
    const newIndex = prefix + (op.newIndex ?? 0);
    ops.push({
      type: "context",
      content: oldLines[oldIndex],
      oldLine: oldIndex + 1,
      newLine: newIndex + 1,
    });
  }

  for (let index = 0; index < suffix; index += 1) {
    const oldIndex = oldLines.length - suffix + index;
    const newIndex = newLines.length - suffix + index;
    ops.push({
      type: "context",
      content: oldLines[oldIndex],
      oldLine: oldIndex + 1,
      newLine: newIndex + 1,
    });
  }

  return ops;
}

/**
 * Collapse a diff into hunks, keeping `contextLines` of unchanged text around
 * each change and merging changes that are close enough to share context.
 */
export function buildLineDiffHunks(
  ops: LineDiffOp[],
  contextLines: number = DEFAULT_CONTEXT_LINES,
): LineDiffHunk[] {
  const changedIndexes = ops
    .map((op, index) => (op.type === "context" ? -1 : index))
    .filter((index) => index >= 0);
  if (changedIndexes.length === 0) return [];

  const ranges: Array<{ start: number; end: number }> = [];
  for (const index of changedIndexes) {
    const start = Math.max(0, index - contextLines);
    const end = Math.min(ops.length - 1, index + contextLines);
    const previous = ranges[ranges.length - 1];
    if (previous && start <= previous.end + 1) {
      previous.end = Math.max(previous.end, end);
    } else {
      ranges.push({ start, end });
    }
  }

  return ranges.map((range) => {
    const hunkOps = ops.slice(range.start, range.end + 1);
    const oldCount = hunkOps.filter((op) => op.type !== "added").length;
    const newCount = hunkOps.filter((op) => op.type !== "removed").length;
    const oldStart = hunkOps.find((op) => op.oldLine !== undefined)?.oldLine ?? 0;
    const newStart = hunkOps.find((op) => op.newLine !== undefined)?.newLine ?? 0;

    return {
      oldStart: oldCount === 0 ? Math.max(oldStart - 1, 0) : oldStart,
      oldCount,
      newStart: newCount === 0 ? Math.max(newStart - 1, 0) : newStart,
      newCount,
      ops: hunkOps,
    };
  });
}

function formatHunkHeader(hunk: LineDiffHunk): string {
  return `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`;
}

/** Flatten hunks into the `GitDiffLine` shape the diff viewers already render. */
export function toGitDiffLines(hunks: LineDiffHunk[]): GitDiffLine[] {
  const lines: GitDiffLine[] = [];

  for (const hunk of hunks) {
    lines.push({ line_type: "header", content: formatHunkHeader(hunk) });
    for (const op of hunk.ops) {
      lines.push({
        line_type: op.type,
        content: op.content,
        old_line_number: op.oldLine,
        new_line_number: op.newLine,
      });
    }
  }

  return lines;
}

/** Convenience wrapper: text in, renderable `GitDiffLine`s out. */
export function buildGitDiffLines(
  oldText: string,
  newText: string,
  contextLines: number = DEFAULT_CONTEXT_LINES,
): GitDiffLine[] {
  return toGitDiffLines(buildLineDiffHunks(diffTextLines(oldText, newText), contextLines));
}
