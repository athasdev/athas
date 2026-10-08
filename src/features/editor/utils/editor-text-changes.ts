import type { EditorModelTextChange } from "../types/editor.types";

/**
 * Read access to a text by offsets. A string is one; an editor document can be one without being
 * copied into a string.
 */
export interface TextSlice {
  readonly length: number;
  slice(start: number, end: number): string;
}

export function textSliceToString(text: TextSlice): string {
  return typeof text === "string" ? text : text.slice(0, text.length);
}

function orderedChanges(
  contentLength: number,
  changes: readonly EditorModelTextChange[],
): EditorModelTextChange[] | null {
  const ordered = [...changes].sort((left, right) => left.rangeOffset - right.rangeOffset);
  let previousEnd = 0;

  for (const change of ordered) {
    const end = change.rangeOffset + change.rangeLength;
    if (
      !Number.isInteger(change.rangeOffset) ||
      !Number.isInteger(change.rangeLength) ||
      change.rangeOffset < previousEnd ||
      change.rangeOffset < 0 ||
      change.rangeLength < 0 ||
      end > contentLength
    ) {
      return null;
    }
    previousEnd = end;
  }

  return ordered;
}

export function applyEditorTextChanges(
  content: string,
  changes: readonly EditorModelTextChange[],
): string | null {
  if (changes.length === 0) return content;
  const ordered = orderedChanges(content.length, changes);
  if (!ordered) return null;

  const pieces: string[] = [];
  let sourceOffset = 0;
  for (const change of ordered) {
    pieces.push(content.slice(sourceOffset, change.rangeOffset), change.text);
    sourceOffset = change.rangeOffset + change.rangeLength;
  }
  pieces.push(content.slice(sourceOffset));
  return pieces.join("");
}

/**
 * Whether applying `changes` to `content` leaves it unchanged. Costs as much as the changed
 * ranges, not the whole document.
 */
export function editorTextChangesAreNoop(
  content: TextSlice,
  changes: readonly EditorModelTextChange[],
): boolean {
  return changes.every(
    (change) =>
      change.text.length === change.rangeLength &&
      content.slice(change.rangeOffset, change.rangeOffset + change.rangeLength) === change.text,
  );
}
