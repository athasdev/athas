import { Range as MonacoRange, Uri } from "monaco-editor";
import type * as Monaco from "monaco-editor";
import type { Position, Range } from "../types/editor.types";

export function toEditorPosition(
  model: Monaco.editor.ITextModel,
  position: Monaco.IPosition,
): Position {
  return {
    line: position.lineNumber - 1,
    column: position.column - 1,
    offset: model.getOffsetAt(position),
  };
}

export function toMonacoPosition(position: Position): Monaco.IPosition {
  return {
    lineNumber: position.line + 1,
    column: position.column + 1,
  };
}

export function clampMonacoPosition(
  model: Monaco.editor.ITextModel,
  position: Monaco.IPosition,
): Monaco.IPosition {
  const lineNumber = Math.max(1, Math.min(model.getLineCount(), position.lineNumber));
  const maxColumn = model.getLineMaxColumn(lineNumber);
  const column = Math.max(1, Math.min(maxColumn, position.column));
  return { lineNumber, column };
}

export function toClampedMonacoPosition(
  model: Monaco.editor.ITextModel,
  position: Position,
): Monaco.IPosition {
  return clampMonacoPosition(model, toMonacoPosition(position));
}

export function toEditorRange(
  model: Monaco.editor.ITextModel,
  selection: Monaco.Selection,
): Range | undefined {
  if (selection.isEmpty()) return undefined;

  const start = selection.getStartPosition();
  const end = selection.getEndPosition();
  return {
    start: toEditorPosition(model, start),
    end: toEditorPosition(model, end),
  };
}

export function toMonacoRange(model: Monaco.editor.ITextModel, range: Range): Monaco.Range {
  let start = toClampedMonacoPosition(model, range.start);
  let end = toClampedMonacoPosition(model, range.end);
  if (
    start.lineNumber > end.lineNumber ||
    (start.lineNumber === end.lineNumber && start.column > end.column)
  ) {
    [start, end] = [end, start];
  }

  return new MonacoRange(start.lineNumber, start.column, end.lineNumber, end.column);
}

export function createModelUri(bufferId: string | undefined, filePath: string): Monaco.Uri {
  const sanitizedPath = filePath.replace(/^\/+/, "");
  const path = sanitizedPath.length > 0 ? sanitizedPath : `${bufferId ?? "untitled"}.txt`;
  return Uri.parse(`athas://editor/${encodeURIComponent(bufferId ?? path)}/${path}`);
}

export function buildLineOffsets(content: string): number[] {
  const offsets = [0];
  for (let index = 0; index < content.length; index++) {
    if (content.charCodeAt(index) === 10) {
      offsets.push(index + 1);
    }
  }
  return offsets;
}
