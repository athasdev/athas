// @vitest-environment jsdom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  applyCodeMirrorInlineEdit,
  inlineEditPreviewExtension,
  showCodeMirrorInlineEditPreview,
} from "../engines/codemirror/features/inline-edit-preview";
import { buildLineOffsets } from "../utils/line-offsets";

const emptyRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
Range.prototype.getClientRects = emptyRects;
Range.prototype.getBoundingClientRect = () => new DOMRect();

let view: EditorView | null = null;

let docChanges = 0;

function createView(doc: string) {
  const parent = document.createElement("div");
  document.body.append(parent);
  docChanges = 0;
  view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        inlineEditPreviewExtension,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) docChanges += 1;
        }),
      ],
    }),
  });
  return view;
}

const removedLines = (editor: EditorView) =>
  [...editor.contentDOM.querySelectorAll(".cm-inline-edit-preview-removed")].map(
    (line) => line.textContent,
  );
const proposedText = (editor: EditorView) =>
  [...editor.contentDOM.querySelectorAll(".cm-inline-edit-preview-line")].map(
    (line) => line.textContent,
  );

afterEach(() => {
  view?.dom.parentElement?.remove();
  view?.destroy();
  view = null;
});

describe("CodeMirror inline edit preview", () => {
  it("tints the replaced lines and shows the resulting lines under them", () => {
    const editor = createView("one\ntwo three\nfour\n");
    const start = "one\ntwo ".length;
    showCodeMirrorInlineEditPreview(
      editor,
      { startOffset: start, endOffset: start + "three".length, editedText: "3\nthree" },
      "\n",
    );

    expect(removedLines(editor)).toEqual(["two three"]);
    expect(proposedText(editor)).toEqual(["two 3", "three"]);
  });

  it("reads buffer offsets with CRLF counted as two characters", () => {
    const editor = createView("one\r\ntwo\r\nthree");
    const content = "one\r\ntwo\r\nthree";
    const start = content.indexOf("three");
    showCodeMirrorInlineEditPreview(
      editor,
      { startOffset: start, endOffset: content.length, editedText: "3" },
      "\r\n",
    );

    expect(removedLines(editor)).toEqual(["three"]);
    expect(proposedText(editor)).toEqual(["3"]);
  });

  it("removes the preview, but a stale cleanup leaves a newer preview alone", () => {
    const editor = createView("alpha\nbeta\n");
    const clearFirst = showCodeMirrorInlineEditPreview(
      editor,
      { startOffset: 0, endOffset: 5, editedText: "ALPHA" },
      "\n",
    );
    const clearSecond = showCodeMirrorInlineEditPreview(
      editor,
      { startOffset: 6, endOffset: 10, editedText: "BETA" },
      "\n",
    );

    clearFirst();
    expect(removedLines(editor)).toEqual(["beta"]);

    clearSecond();
    expect(removedLines(editor)).toEqual([]);
    expect(proposedText(editor)).toEqual([]);
  });

  it("keeps the preview on its lines while text above it changes", () => {
    const editor = createView("a\nb\nc");
    showCodeMirrorInlineEditPreview(
      editor,
      { startOffset: 4, endOffset: 5, editedText: "C" },
      "\n",
    );
    editor.dispatch({ changes: { from: 0, insert: "new\n" } });

    expect(removedLines(editor)).toEqual(["c"]);
  });

  it("applies the edit as one transaction and puts the cursor after it", () => {
    const editor = createView("one\r\ntwo\r\nthree");
    const content = "one\r\ntwo\r\nthree";
    const start = content.indexOf("two");
    applyCodeMirrorInlineEdit(
      editor,
      {
        range: {
          start: { line: 1, column: 0, offset: start },
          end: { line: 1, column: 3, offset: start + 3 },
        },
        editedText: "2\r\n2b",
      },
      "\r\n",
    );

    expect(editor.state.doc.toString()).toBe("one\n2\n2b\nthree");
    expect(editor.state.selection.main.head).toBe("one\n2\n2b".length);
    expect(docChanges).toBe(1);
  });
});

describe("buildLineOffsets", () => {
  it("starts a line after every line feed", () => {
    expect(buildLineOffsets("a\nbc\r\nd")).toEqual([0, 2, 6]);
  });
});
