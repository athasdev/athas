import type { EditorModelTextChange } from "../types/editor.types";

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

export function normalizeEditorContentEol(content: string, eol: "\n" | "\r\n"): string {
  return content.replace(/\r\n|\r|\n/g, eol);
}
