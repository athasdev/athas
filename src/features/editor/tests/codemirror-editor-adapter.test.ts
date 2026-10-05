// @vitest-environment jsdom
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  createCodeMirrorEditorAdapter,
  insertCursorsAtLineEnds,
  selectPreviousOccurrence,
} from "../engines/codemirror/editor-adapter";

let view: EditorView | null = null;

function createView(doc: string, selection: EditorSelection) {
  view = new EditorView({
    state: EditorState.create({
      doc,
      selection,
      extensions: EditorState.allowMultipleSelections.of(true),
    }),
  });
  return view;
}

afterEach(() => {
  view?.destroy();
  view = null;
});

describe("CodeMirror editor adapter commands", () => {
  it("adds the previous occurrence of the selected text", () => {
    const editor = createView("foo bar foo baz foo", EditorSelection.single(16, 19));

    expect(selectPreviousOccurrence(editor)).toBe(true);
    expect(editor.state.selection.ranges.map((range) => range.from)).toEqual([8, 16]);
  });

  it("wraps around to the end when nothing earlier matches", () => {
    const editor = createView("foo bar foo", EditorSelection.single(0, 3));

    expect(selectPreviousOccurrence(editor)).toBe(true);
    expect(editor.state.selection.ranges.map((range) => range.from)).toEqual([0, 8]);
  });

  it("puts a cursor at the end of every selected line", () => {
    const editor = createView("one\ntwo\nthree", EditorSelection.single(1, 9));

    insertCursorsAtLineEnds(editor);
    expect(editor.state.selection.ranges.map((range) => range.head)).toEqual([3, 7, 13]);
  });

  it("replaces every selection when inserting without a position", () => {
    const editor = createView(
      "a b a",
      EditorSelection.create([EditorSelection.range(0, 1), EditorSelection.range(4, 5)]),
    );
    const adapter = createCodeMirrorEditorAdapter("owner", () => editor, {
      undo: () => {},
      redo: () => {},
    });

    adapter.insertText("x");
    expect(editor.state.doc.toString()).toBe("x b x");
  });

  it("replaces a range and leaves the cursor after the new text", () => {
    const editor = createView("const a = 1;", EditorSelection.single(0));
    const adapter = createCodeMirrorEditorAdapter("owner", () => editor, {
      undo: () => {},
      redo: () => {},
    });

    adapter.replaceRange(
      { start: { line: 0, column: 6, offset: 6 }, end: { line: 0, column: 7, offset: 7 } },
      "value",
    );
    expect(editor.state.doc.toString()).toBe("const value = 1;");
    expect(editor.state.selection.main.head).toBe(11);
  });
});
