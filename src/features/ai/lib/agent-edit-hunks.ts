import type {
  AgentEditEntry,
  AgentEditHunk,
  AgentFileWrite,
  LineEdit,
} from "@/features/ai/types/agent-edits.types";
import { diffTextLines } from "@/features/git/utils/line-diff";

/** Split the way `diffTextLines` does, so hunk line indexes line up with its output. */
function splitLines(text: string): string[] {
  return text.length > 0 ? text.split("\n") : [];
}

function joinLines(lines: string[]): string {
  return lines.join("\n");
}

/**
 * The changes from `base` to `current`, one hunk per run of changed lines with no context around
 * it, so each hunk can be kept or rejected on its own.
 */
export function computeAgentHunks(base: string, current: string): AgentEditHunk[] {
  if (base === current) return [];
  const hunks: AgentEditHunk[] = [];
  let open: AgentEditHunk | null = null;
  let baseIndex = 0;
  let currentIndex = 0;

  for (const op of diffTextLines(base, current)) {
    if (op.type === "context") {
      open = null;
      baseIndex += 1;
      currentIndex += 1;
      continue;
    }
    if (!open) {
      open = { baseStart: baseIndex, baseLines: [], currentStart: currentIndex, currentLines: [] };
      hunks.push(open);
    }
    if (op.type === "removed") {
      open.baseLines.push(op.content);
      baseIndex += 1;
    } else {
      open.currentLines.push(op.content);
      currentIndex += 1;
    }
  }
  return hunks;
}

function sliceMatches(lines: string[], start: number, expected: string[]): boolean {
  if (start + expected.length > lines.length) return false;
  return expected.every((line, index) => lines[start + index] === line);
}

function spliceLines(text: string, edit: LineEdit): string {
  const lines = splitLines(text);
  lines.splice(edit.start, edit.deleteCount, ...edit.lines);
  return joinLines(lines);
}

/** Keep a hunk: the baseline takes the agent's lines, so the hunk is no longer a change. */
export function keepHunk(entry: AgentEditEntry, hunk: AgentEditHunk): string | null {
  if (!sliceMatches(splitLines(entry.baseline), hunk.baseStart, hunk.baseLines)) return null;
  return spliceLines(entry.baseline, {
    start: hunk.baseStart,
    deleteCount: hunk.baseLines.length,
    lines: hunk.currentLines,
  });
}

/** The edit to the current text that puts a hunk's baseline lines back. */
export function rejectEdit(hunk: AgentEditHunk): LineEdit {
  return { start: hunk.currentStart, deleteCount: hunk.currentLines.length, lines: hunk.baseLines };
}

/** Reject a hunk: the file gets the baseline's lines back. Null when the hunk is stale. */
export function rejectHunk(entry: AgentEditEntry, hunk: AgentEditHunk): string | null {
  if (!sliceMatches(splitLines(entry.current), hunk.currentStart, hunk.currentLines)) return null;
  return spliceLines(entry.current, rejectEdit(hunk));
}

function hunksToEdits(hunks: AgentEditHunk[]): LineEdit[] {
  return hunks.map((hunk) => ({
    start: hunk.baseStart,
    deleteCount: hunk.baseLines.length,
    lines: hunk.currentLines,
  }));
}

/**
 * Whether an edit and a change touch the same lines. Two replacements that only meet at a
 * boundary do not; an insertion at either end of the other range does, since which goes first
 * would be a guess.
 */
function overlaps(start: number, end: number, otherStart: number, otherEnd: number): boolean {
  if (start < otherEnd && otherStart < end) return true;
  const eitherEmpty = start === end || otherStart === otherEnd;
  return eitherEmpty && start <= otherEnd && otherStart <= end;
}

/**
 * Applies `edits`, made against `from`, to `to`, a text that differs from `from` in places. Each
 * edit moves by the lines `to` gained or lost before it. Returns null when an edit touches lines
 * that differ between the two texts, where carrying it over could garble either change.
 */
export function transferLineEdits(from: string, to: string, edits: LineEdit[]): string | null {
  const changes = computeAgentHunks(from, to);
  const mapped: LineEdit[] = [];

  for (const edit of edits) {
    const end = edit.start + edit.deleteCount;
    let shift = 0;
    for (const change of changes) {
      const changeEnd = change.baseStart + change.baseLines.length;
      if (overlaps(edit.start, end, change.baseStart, changeEnd)) return null;
      if (changeEnd <= edit.start) {
        shift += change.currentLines.length - change.baseLines.length;
      }
    }
    mapped.push({ ...edit, start: edit.start + shift });
  }

  const lines = splitLines(to);
  for (const edit of [...mapped].sort((a, b) => b.start - a.start)) {
    lines.splice(edit.start, edit.deleteCount, ...edit.lines);
  }
  return joinLines(lines);
}

/**
 * Brings an entry up to date with a file that changed on disk without the agent. Edits away from
 * the agent's hunks move into the baseline, so they are not mistaken for the agent's; the hunks
 * stay reviewable. Returns null when an edit touches an agent hunk, in which case the log can no
 * longer tell whose lines are whose.
 */
export function rebaseOnDisk(entry: AgentEditEntry, disk: string): AgentEditEntry | null {
  if (disk === entry.current) return entry;
  const userEdits = hunksToEdits(computeAgentHunks(entry.current, disk));
  const baseline = transferLineEdits(entry.current, entry.baseline, userEdits);
  if (baseline === null) return null;
  return { ...entry, baseline, current: disk, revision: entry.revision + 1 };
}

export interface RecordedWrite {
  /** The entry after the write; null when nothing is left to review. */
  entry: AgentEditEntry | null;
  /** Earlier unreviewed changes could not be carried over and now count as kept. */
  lostEarlierReview: boolean;
}

/**
 * Adds an agent write to the file's entry. A first write takes the file as it was before as the
 * baseline; later writes build on the same baseline until the changes are reviewed. If the file
 * changed in between on its own, that change is rebased first, and when it cannot be, review
 * starts over from the text the agent overwrote.
 */
export function recordAgentWrite(
  existing: AgentEditEntry | undefined,
  write: AgentFileWrite,
): RecordedWrite {
  let base: AgentEditEntry | null = existing ?? null;
  let lostEarlierReview = false;

  if (base && write.previousContent !== base.current) {
    const rebased =
      write.previousContent === null ? null : rebaseOnDisk(base, write.previousContent);
    lostEarlierReview = rebased === null;
    base = rebased;
  }

  const entry: AgentEditEntry = base
    ? { ...base, current: write.content, revision: base.revision + 1 }
    : {
        path: write.path,
        baseline: write.previousContent ?? "",
        current: write.content,
        created: write.previousContent === null,
        revision: (existing?.revision ?? 0) + 1,
      };

  if (entry.baseline === entry.current) {
    return { entry: null, lostEarlierReview };
  }
  return { entry, lostEarlierReview };
}

/** Whether an entry has nothing left to review. */
export function isResolved(entry: AgentEditEntry): boolean {
  return entry.baseline === entry.current;
}

export function countChangedLines(hunks: AgentEditHunk[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const hunk of hunks) {
    added += hunk.currentLines.length;
    removed += hunk.baseLines.length;
  }
  return { added, removed };
}

export interface AgentHunkPreviewLine {
  type: "context" | "added" | "removed";
  content: string;
  /** 1-based line in the baseline; absent on added lines. */
  oldLine?: number;
  /** 1-based line in the current text; absent on removed lines. */
  newLine?: number;
}

/** A hunk's lines for display, with up to `contextLines` unchanged lines around it. */
export function buildHunkPreviewLines(
  current: string,
  hunk: AgentEditHunk,
  contextLines = 2,
): AgentHunkPreviewLine[] {
  const lines = splitLines(current);
  const preview: AgentHunkPreviewLine[] = [];
  const context = (newIndex: number, shift: number) =>
    preview.push({
      type: "context",
      content: lines[newIndex],
      oldLine: newIndex + shift + 1,
      newLine: newIndex + 1,
    });

  const beforeShift = hunk.baseStart - hunk.currentStart;
  for (
    let index = Math.max(0, hunk.currentStart - contextLines);
    index < hunk.currentStart;
    index++
  ) {
    context(index, beforeShift);
  }
  hunk.baseLines.forEach((content, offset) =>
    preview.push({ type: "removed", content, oldLine: hunk.baseStart + offset + 1 }),
  );
  hunk.currentLines.forEach((content, offset) =>
    preview.push({ type: "added", content, newLine: hunk.currentStart + offset + 1 }),
  );
  const afterStart = hunk.currentStart + hunk.currentLines.length;
  const afterShift = hunk.baseStart + hunk.baseLines.length - afterStart;
  for (let index = afterStart; index < Math.min(lines.length, afterStart + contextLines); index++) {
    context(index, afterShift);
  }
  return preview;
}

/** The 1-based line to open a hunk at in the current file. */
export function hunkLine(hunk: AgentEditHunk): number {
  return hunk.currentStart + 1;
}
