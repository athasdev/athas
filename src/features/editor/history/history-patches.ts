import type { EditorModelTextChange } from "../types/editor.types";
import type { HistoryPatchBatch, HistoryPatchChange } from "../types/history.types";
import { applyEditorTextChanges } from "../utils/editor-text-changes";

function applyPatchChanges(
  content: string,
  changes: readonly HistoryPatchChange[],
  direction: "forward" | "reverse",
): string | null {
  for (const change of changes) {
    const expected = direction === "forward" ? change.beforeText : change.afterText;
    if (content.slice(change.rangeOffset, change.rangeOffset + expected.length) !== expected) {
      return null;
    }
  }
  const replacements = changes.map((change) => ({
    rangeOffset: change.rangeOffset,
    rangeLength: direction === "forward" ? change.beforeText.length : change.afterText.length,
    text: direction === "forward" ? change.afterText : change.beforeText,
    startLine: 0,
    startColumn: 0,
    endLine: 0,
    endColumn: 0,
  }));
  return applyEditorTextChanges(content, replacements);
}

export function createHistoryPatchBatch(
  previousContent: string,
  changes: readonly EditorModelTextChange[],
): HistoryPatchBatch | null {
  const orderedChanges = [...changes].sort((left, right) => left.rangeOffset - right.rangeOffset);
  let previousEnd = 0;
  let lengthDelta = 0;
  for (const change of orderedChanges) {
    const end = change.rangeOffset + change.rangeLength;
    if (
      !Number.isInteger(change.rangeOffset) ||
      !Number.isInteger(change.rangeLength) ||
      change.rangeOffset < previousEnd ||
      change.rangeOffset < 0 ||
      change.rangeLength < 0 ||
      end > previousContent.length
    ) {
      return null;
    }
    previousEnd = end;
    lengthDelta += change.text.length - change.rangeLength;
  }
  const patches = orderedChanges.map((change) => {
    return {
      rangeOffset: change.rangeOffset,
      beforeText: previousContent.slice(
        change.rangeOffset,
        change.rangeOffset + change.rangeLength,
      ),
      afterText: change.text,
    };
  });

  return {
    beforeLength: previousContent.length,
    afterLength: previousContent.length + lengthDelta,
    changes: patches,
  };
}

export function applyHistoryPatchBatch(
  content: string,
  batch: HistoryPatchBatch,
  direction: "forward" | "reverse",
): string | null {
  if (direction === "forward") {
    if (content.length !== batch.beforeLength) return null;
    return applyPatchChanges(content, batch.changes, "forward");
  }

  if (content.length !== batch.afterLength) return null;
  let accumulatedDelta = 0;
  const reverseChanges = batch.changes.map((change) => {
    const rangeOffset = change.rangeOffset + accumulatedDelta;
    accumulatedDelta += change.afterText.length - change.beforeText.length;
    return { ...change, rangeOffset };
  });
  return applyPatchChanges(content, reverseChanges, "reverse");
}

export function applyHistoryPatchBatches(
  content: string,
  batches: readonly HistoryPatchBatch[],
  direction: "forward" | "reverse",
): string | null {
  const ordered = direction === "forward" ? batches : [...batches].reverse();
  let result = content;
  for (const batch of ordered) {
    const next = applyHistoryPatchBatch(result, batch, direction);
    if (next === null) return null;
    result = next;
  }
  return result;
}
