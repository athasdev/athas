// @vitest-environment jsdom
import { javascript } from "@codemirror/lang-javascript";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { forceParsing, StreamLanguage } from "@codemirror/language";
import { kotlin } from "@codemirror/legacy-modes/mode/clike";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { enclosingScopes } from "../engines/codemirror/features/sticky-scroll/sticky-scopes";
import {
  computeStickyRows,
  stickyScroll,
} from "../engines/codemirror/features/sticky-scroll/sticky-scroll";

const emptyRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
Range.prototype.getClientRects = emptyRects;
Range.prototype.getBoundingClientRect = () => new DOMRect();

const LINE_HEIGHT = 10;

function headerLines(doc: string, extension: Extension, lineNumber: number) {
  // Parse the whole document first: state creation only parses within a time budget, which a
  // busy test run can exhaust before the tree is complete.
  const view = new EditorView({ state: EditorState.create({ doc, extensions: [extension] }) });
  forceParsing(view, doc.length, 5000);
  const lines = enclosingScopes(view.state, lineNumber).map((scope) => scope.line);
  view.destroy();
  return lines;
}

const jsSource = [
  "class Store {", // 1
  "  load() {", // 2
  "    if (ready) {", // 3
  "      fetch();", // 4
  "    }", // 5
  "  }", // 6
  "", // 7
  "  save() {", // 8
  "    write();", // 9
  "  }", // 10
  "}", // 11
].join("\n");

describe("sticky scroll scopes", () => {
  it("finds the enclosing classes, functions and blocks from the syntax tree", () => {
    expect(headerLines(jsSource, javascript(), 4)).toEqual([1, 2, 3]);
    expect(headerLines(jsSource, javascript(), 9)).toEqual([1, 8]);
    expect(headerLines(jsSource, javascript(), 7)).toEqual([1]);
    expect(headerLines(jsSource, javascript(), 1)).toEqual([]);
  });

  it("follows Python's indented bodies", () => {
    const source = ["class A:", "    def f(self):", "        return 1", "", "x = 1"].join("\n");
    expect(headerLines(source, python(), 3)).toEqual([1, 2]);
    expect(headerLines(source, python(), 5)).toEqual([]);
  });

  it("uses Markdown headings and ignores # lines inside code blocks", () => {
    const source = [
      "# Guide", // 1
      "## Setup", // 2
      "```sh", // 3
      "# not a heading", // 4
      "```", // 5
      "text", // 6
      "## Usage", // 7
      "### Flags", // 8
      "more", // 9
    ].join("\n");
    expect(headerLines(source, markdown(), 6)).toEqual([1, 2]);
    expect(headerLines(source, markdown(), 9)).toEqual([1, 7, 8]);
    expect(headerLines(source, markdown(), 8)).toEqual([1, 7]);
  });

  it("falls back to indentation for stream languages and plain text", () => {
    const source = [
      "class A {", // 1
      "  fun b() {", // 2
      "    x()", // 3
      "  }", // 4
      "  fun c() {", // 5
      "", // 6
      "    y()", // 7
      "  }", // 8
      "}", // 9
    ].join("\n");
    expect(headerLines(source, StreamLanguage.define(kotlin), 7)).toEqual([1, 5]);
    expect(headerLines(source, StreamLanguage.define(kotlin), 6)).toEqual([1, 5]);
    expect(headerLines(source, [], 3)).toEqual([1, 2]);
    const state = EditorState.create({ doc: source });
    expect(enclosingScopes(state, 3).map((scope) => state.doc.lineAt(scope.end).number)).toEqual([
      9, 4,
    ]);
  });
});

function rowsAt(doc: string, scrollTop: number, maxLines = 5) {
  const state = EditorState.create({ doc, extensions: [javascript()] });
  return computeStickyRows(
    state,
    scrollTop,
    LINE_HEIGHT,
    maxLines,
    (height) => state.doc.line(Math.min(state.doc.lines, Math.floor(height / LINE_HEIGHT) + 1)),
    (pos) => state.doc.lineAt(pos).number * LINE_HEIGHT,
  );
}

describe("sticky scroll rows", () => {
  it("pins the headers of the scopes around the top line", () => {
    expect(rowsAt(jsSource, 0)).toEqual([]);
    expect(rowsAt(jsSource, 15)).toEqual([
      { line: 1, offset: 0 },
      { line: 2, offset: 0 },
      { line: 3, offset: 0 },
    ]);
  });

  it("pins a header that scrolled under the pinned rows", () => {
    // Line 8 (`save() {`) sits right under the class header row.
    expect(rowsAt(jsSource, 70)).toEqual([
      { line: 1, offset: 0 },
      { line: 8, offset: 0 },
    ]);
  });

  it("lets the end of a scope push its header up", () => {
    // `if` ends on line 5; with the top at 22 its row (the third) would reach past that line.
    const rows = rowsAt(jsSource, 22);
    expect(rows.map((row) => row.line)).toEqual([1, 2, 3]);
    expect(rows[2].offset).toBeLessThan(0);
    expect(rows[2].offset).toBeGreaterThan(-LINE_HEIGHT);
  });

  it("limits the number of pinned lines", () => {
    expect(rowsAt(jsSource, 15, 2).map((row) => row.line)).toEqual([1, 2]);
  });
});

describe("sticky scroll view", () => {
  let view: EditorView | null = null;

  afterEach(() => {
    view?.destroy();
    view = null;
    document.body.textContent = "";
  });

  it("renders pinned rows and jumps to a header when it is clicked", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    view = new EditorView({
      parent,
      state: EditorState.create({ doc: jsSource, extensions: [javascript(), stickyScroll()] }),
    });
    const current = view;
    const { doc } = current.state;
    Object.defineProperty(current, "documentTop", { get: () => -15 });
    Object.defineProperty(current, "defaultLineHeight", { get: () => LINE_HEIGHT });
    current.lineBlockAtHeight = ((height: number) =>
      doc.line(Math.min(doc.lines, Math.floor(height / LINE_HEIGHT) + 1))) as never;
    current.lineBlockAt = ((pos: number) => ({
      bottom: doc.lineAt(pos).number * LINE_HEIGHT,
    })) as never;

    current.requestMeasure();
    (current as unknown as { measure(): void }).measure();
    current.dispatch({ effects: [] });
    (current as unknown as { measure(): void }).measure();

    const rows = [...current.dom.querySelectorAll<HTMLElement>(".cm-athas-sticky-row")];
    expect(rows.map((row) => row.dataset.line)).toEqual(["1", "2", "3"]);
    expect(rows[1].querySelector(".cm-athas-sticky-text")?.textContent).toBe("  load() {");

    rows[1].dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    expect(current.state.selection.main.head).toBe(doc.line(2).from + 2);
  });
});
