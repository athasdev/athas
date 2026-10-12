// @vitest-environment jsdom
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { athasLineNumbers, type LineNumberOptions } from "../engines/codemirror/line-numbers";
import { highlightCode, loadHighlightLanguage, toLineTokens } from "../services/syntax-highlight";

const views: EditorView[] = [];

function mount(doc: string, options: LineNumberOptions, cursorLine = 1) {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(0),
    extensions: [athasLineNumbers(options)],
  });
  const view = new EditorView({ state, parent: document.body });
  views.push(view);
  const line = view.state.doc.line(cursorLine);
  view.dispatch({ selection: EditorSelection.cursor(line.from) });
  return view;
}

const gutterNumbers = (view: EditorView) =>
  Array.from(view.dom.querySelectorAll(".cm-lineNumbers .cm-gutterElement"))
    .map((element) => element.textContent)
    .filter((text) => text !== "");

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.innerHTML = "";
});

describe("line number gutter", () => {
  it("numbers lines from an offset or from a map", () => {
    expect(gutterNumbers(mount("a\nb\nc", { start: 40 }))).toEqual(
      expect.arrayContaining(["40", "41", "42"]),
    );
    expect(gutterNumbers(mount("a\nb\nc", { map: [7, null, 12] }))).toEqual(
      expect.arrayContaining(["7", "2", "12"]),
    );
  });

  it("shows distances from the cursor line for relative numbering", () => {
    const view = mount("a\nb\nc\nd", { relative: true }, 2);
    expect(gutterNumbers(view)).toEqual(expect.arrayContaining(["1", "2", "1", "2"]));

    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.line(4).from) });
    view.dispatch({ changes: { from: view.state.doc.length, insert: "\ne" } });
    expect(gutterNumbers(view)).toEqual(expect.arrayContaining(["3", "4", "1"]));
  });
});

describe("syntax tokens", () => {
  it("splits multi-line segments into per-line tokens", () => {
    const code = "/* a\nbb */ x\n\ny";
    const tokens = toLineTokens(code, [
      { start: 0, end: 10, className: "token-comment" },
      { start: 11, end: 12, className: "token-variable" },
      { start: 14, end: 15, className: "token-variable" },
    ]);

    expect(tokens).toEqual([
      { line: 0, startColumn: 0, endColumn: 4, className: "token-comment" },
      { line: 1, startColumn: 0, endColumn: 5, className: "token-comment" },
      { line: 1, startColumn: 6, endColumn: 7, className: "token-variable" },
      { line: 3, startColumn: 0, endColumn: 1, className: "token-variable" },
    ]);
  });

  it("loads a language on demand and highlights code with it", async () => {
    await loadHighlightLanguage("json");
    const segments = await highlightCode('{"a": 1}', "json");

    expect(segments.length).toBeGreaterThan(0);
    expect(segments.every((segment) => segment.className.startsWith("token-"))).toBe(true);
    await expect(highlightCode("plain", "no-such-language")).resolves.toEqual([]);
  });
});
