import { EditorState, type TransactionSpec } from "@codemirror/state";
import { describe, expect, it } from "vite-plus/test";
import {
  detectLineSeparator,
  minimalReplacement,
  toBufferText,
  toModelContentChangeEvent,
} from "../engines/codemirror/document-change";
import type { ModelContentChangeEvent } from "../services/document-change-batch";
import { applyEditorTextChanges } from "../utils/editor-text-changes";

/** The shape the buffer applies: zero-based lines and columns. */
function toBufferChanges(event: ModelContentChangeEvent) {
  return event.changes.map((change) => ({
    rangeOffset: change.rangeOffset,
    rangeLength: change.rangeLength,
    text: change.text,
    startLine: change.range.startLineNumber - 1,
    startColumn: change.range.startColumn - 1,
    endLine: change.range.endLineNumber - 1,
    endColumn: change.range.endColumn - 1,
  }));
}

function edit(doc: string, spec: TransactionSpec, separator = detectLineSeparator(doc)) {
  const state = EditorState.create({ doc });
  const transaction = state.update(spec);
  const event = toModelContentChangeEvent(transaction.changes, state.doc, 7, separator);
  return { event, after: toBufferText(transaction.state.doc, separator) };
}

describe("CodeMirror document changes", () => {
  it("describes edits in the old document, last to first, with zero-based positions", () => {
    const { event } = edit("abc\ndef\n", {
      changes: [
        { from: 1, to: 2, insert: "X" },
        { from: 4, insert: "Y\nZ" },
      ],
    });

    expect(event.versionId).toBe(7);
    expect(event.changes).toEqual([
      {
        rangeOffset: 4,
        rangeLength: 0,
        text: "Y\nZ",
        range: { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 1 },
      },
      {
        rangeOffset: 1,
        rangeLength: 1,
        text: "X",
        range: { startLineNumber: 1, startColumn: 2, endLineNumber: 1, endColumn: 3 },
      },
    ]);
  });

  it("produces changes that rebuild the editor text from the old buffer text", () => {
    const before = "first line\nsecond line\nthird line\n";
    const { event, after } = edit(before, {
      changes: [
        { from: 0, to: 5, insert: "1st" },
        { from: 18, to: 22, insert: "" },
        { from: 34, insert: "fourth\n" },
      ],
    });

    expect(applyEditorTextChanges(before, toBufferChanges(event))).toBe(after);
  });

  it("counts CRLF line breaks twice in buffer offsets and keeps CRLF in inserted text", () => {
    const before = "ab\r\ncd\r\nef";
    const { event, after } = edit(before, { changes: { from: 6, insert: "X\nY" } });

    expect(after).toBe("ab\r\ncd\r\nX\r\nYef");
    expect(event.eol).toBe("\r\n");
    expect(event.changes[0]).toMatchObject({ rangeOffset: 8, rangeLength: 0, text: "X\r\nY" });
    expect(applyEditorTextChanges(before, toBufferChanges(event))).toBe(after);
  });

  it("finds the smallest replacement between two texts", () => {
    expect(minimalReplacement("same", "same")).toBeNull();
    expect(minimalReplacement("hello world", "hello brave world")).toEqual({
      from: 6,
      to: 6,
      insert: "brave ",
    });
    expect(minimalReplacement("abcdef", "abXef")).toEqual({ from: 2, to: 4, insert: "X" });
  });
});
