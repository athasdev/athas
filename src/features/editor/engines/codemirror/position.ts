import { EditorSelection, type SelectionRange, type Text } from "@codemirror/state";
import type { Position, Range } from "../../types/editor.types";
import type { LineSeparator } from "./document-change";

/** An editor position (zero-based line and column, offset in the buffer's text) for a document position. */
export function toEditorPosition(doc: Text, position: number, separator: LineSeparator): Position {
  const line = doc.lineAt(position);
  return {
    line: line.number - 1,
    column: position - line.from,
    offset: position + (line.number - 1) * (separator.length - 1),
  };
}

/** The document position for an editor position, clamped to the document. */
export function fromEditorPosition(doc: Text, position: Position): number {
  const lineNumber = Math.max(1, Math.min(doc.lines, position.line + 1));
  const line = doc.line(lineNumber);
  return line.from + Math.max(0, Math.min(line.length, position.column));
}

/** The selected range, or undefined for a bare cursor. */
export function toEditorRange(
  doc: Text,
  range: SelectionRange,
  separator: LineSeparator,
): Range | undefined {
  if (range.empty) return undefined;
  return {
    start: toEditorPosition(doc, range.from, separator),
    end: toEditorPosition(doc, range.to, separator),
  };
}

/** A CodeMirror selection for an editor range, clamped and ordered. */
export function fromEditorRange(doc: Text, range: Range): SelectionRange {
  const start = fromEditorPosition(doc, range.start);
  const end = fromEditorPosition(doc, range.end);
  return EditorSelection.range(Math.min(start, end), Math.max(start, end));
}
