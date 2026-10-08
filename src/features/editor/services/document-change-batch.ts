import type {
  EditorDocumentChangeBatch,
  EditorDocumentChangeResult,
  EditorModelTextChange,
} from "../types/editor.types";

interface ModelContentChange {
  rangeOffset: number;
  rangeLength: number;
  text: string;
  range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
}

export interface ModelContentChangeEvent {
  changes: readonly ModelContentChange[];
  versionId: number;
  eol: string;
  isEolChange: boolean;
  isFlush: boolean;
  isUndoing: boolean;
  isRedoing: boolean;
}

interface ModelContentSource {
  getValueLength: () => number;
  getValue: () => string;
}

interface DeliverModelContentChangeOptions {
  event: ModelContentChangeEvent;
  model: ModelContentSource;
  sourceId: string;
  modelSessionId: string;
  /** Whether the buffer held exactly the model's text before this event. */
  bufferMatchesModel: boolean;
  apply: (batch: EditorDocumentChangeBatch) => EditorDocumentChangeResult;
}

function toModelTextChange(change: ModelContentChange): EditorModelTextChange {
  return {
    rangeOffset: change.rangeOffset,
    rangeLength: change.rangeLength,
    text: change.text,
    startLine: change.range.startLineNumber - 1,
    startColumn: change.range.startColumn - 1,
    endLine: change.range.endLineNumber - 1,
    endColumn: change.range.endColumn - 1,
  };
}

function createBatch(
  { event, model, sourceId, modelSessionId }: DeliverModelContentChangeOptions,
  incremental: boolean,
): EditorDocumentChangeBatch {
  const base = {
    sourceId,
    modelSessionId,
    modelVersionId: event.versionId,
    eol: event.eol === "\r\n" ? ("\r\n" as const) : ("\n" as const),
    isEolChange: event.isEolChange,
    isUndoing: event.isUndoing,
    isRedoing: event.isRedoing,
  };
  if (incremental) {
    return {
      ...base,
      changes: event.changes.map(toModelTextChange),
      isFlush: false,
      expectedContentLength: model.getValueLength(),
    };
  }
  return { ...base, changes: [], isFlush: true, fullContent: model.getValue() };
}

/**
 * Sends one editor content event to the buffer. Both engines describe their edits in this shape:
 * each change's range is in the document as it was before the event, ordered last to first. The
 * offsets describe the editor's text, so they are only sent as a delta while the buffer holds
 * that same text. Otherwise, and whenever a delta does not land cleanly, the buffer takes the
 * editor's full text instead. The editor is the copy the user is typing into, so it is never
 * rolled back to the buffer.
 */
export function deliverModelContentChange(options: DeliverModelContentChangeOptions): {
  result: EditorDocumentChangeResult;
  bufferMatchesModel: boolean;
} {
  const { event, bufferMatchesModel, apply } = options;
  const incremental =
    bufferMatchesModel && !event.isFlush && !event.isEolChange && event.changes.length > 0;
  let result = apply(createBatch(options, incremental));
  if (incremental && !result.synchronized) {
    result = apply(createBatch(options, false));
  }
  return { result, bufferMatchesModel: result.synchronized };
}
