import type { ChangeSet, Text } from "@codemirror/state";
import type { ModelContentChangeEvent } from "../../services/document-change-batch";

export type LineSeparator = "\n" | "\r\n";

/** The line separator a file uses, from its first line break. */
export function detectLineSeparator(content: string): LineSeparator {
  const newline = content.indexOf("\n");
  return newline > 0 && content[newline - 1] === "\r" ? "\r\n" : "\n";
}

/** The document as the buffer holds it, with the file's own line separator. */
export function toBufferText(doc: Text, separator: LineSeparator) {
  return doc.sliceString(0, doc.length, separator);
}

/**
 * CodeMirror counts every line break as one character; the buffer holds the file's own
 * separator. Offsets sent to the buffer are in its text, so CRLF breaks count twice.
 */
function toBufferOffset(doc: Text, position: number, separator: LineSeparator) {
  return position + (doc.lineAt(position).number - 1) * (separator.length - 1);
}

/**
 * Describes a CodeMirror change set the way the buffer and the LSP sync expect edits: each range
 * in the document as it was before the change, with zero-based lines and columns, ordered last to
 * first so they can be applied one after another.
 */
export function toModelContentChangeEvent(
  changes: ChangeSet,
  startDoc: Text,
  versionId: number,
  separator: LineSeparator,
): ModelContentChangeEvent {
  const result: ModelContentChangeEvent["changes"][number][] = [];
  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    const startLine = startDoc.lineAt(fromA);
    const endLine = startDoc.lineAt(toA);
    const startOffset = toBufferOffset(startDoc, fromA, separator);
    const endOffset = toBufferOffset(startDoc, toA, separator);
    result.push({
      rangeOffset: startOffset,
      rangeLength: endOffset - startOffset,
      text: inserted.sliceString(0, inserted.length, separator),
      range: {
        startLineNumber: startLine.number,
        startColumn: fromA - startLine.from + 1,
        endLineNumber: endLine.number,
        endColumn: toA - endLine.from + 1,
      },
    });
  });
  result.reverse();

  return {
    changes: result,
    versionId,
    eol: separator,
    isEolChange: false,
    isFlush: false,
    isUndoing: false,
    isRedoing: false,
  };
}

/**
 * The smallest single replacement that turns `current` into `next`, so an external update keeps
 * the cursor and scroll position wherever the text did not change.
 */
export function minimalReplacement(current: string, next: string) {
  if (current === next) return null;
  let start = 0;
  const shortest = Math.min(current.length, next.length);
  while (start < shortest && current.charCodeAt(start) === next.charCodeAt(start)) start++;
  let endCurrent = current.length;
  let endNext = next.length;
  while (
    endCurrent > start &&
    endNext > start &&
    current.charCodeAt(endCurrent - 1) === next.charCodeAt(endNext - 1)
  ) {
    endCurrent--;
    endNext--;
  }
  return { from: start, to: endCurrent, insert: next.slice(start, endNext) };
}
