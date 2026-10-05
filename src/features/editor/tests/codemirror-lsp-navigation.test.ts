// @vitest-environment jsdom
import { foldable } from "@codemirror/language";
import { EditorState, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@/extensions/registry/extension-registry", () => ({
  extensionRegistry: { isLspSupported: (path: string) => path.endsWith(".ts") },
}));

const { groupCodeActions } = await import("../engines/codemirror/navigation/code-action-groups");
const { codeLensDecorations, parseShowReferencesArguments } =
  await import("../engines/codemirror/navigation/code-lens");
const { findDocumentLinkAt } = await import("../engines/codemirror/navigation/document-links");
const { inlayHintDecorations } = await import("../engines/codemirror/navigation/inlay-hints");
const { fromLspPosition, isLspHost, lspTextEditsToChanges, toLspPosition } =
  await import("../engines/codemirror/navigation/lsp-document");
const { lspFolding, lspFoldRegions, setLspFoldingRanges } =
  await import("../engines/codemirror/navigation/lsp-folding");
const { onTypeFormattingTrigger } =
  await import("../engines/codemirror/navigation/on-type-formatting");
const { groupReferenceLocations } =
  await import("../engines/codemirror/navigation/reference-groups");
const { closeReferencesPeekEffect, openReferencesPeekEffect, referencesPeekField } =
  await import("../engines/codemirror/navigation/references-peek");
const { expandSelectionTarget, flattenSelectionRanges } =
  await import("../engines/codemirror/navigation/selection-ranges");

const range = (startLine: number, startChar: number, endLine: number, endChar: number) => ({
  start: { line: startLine, character: startChar },
  end: { line: endLine, character: endChar },
});

describe("LSP positions and edits", () => {
  const doc = Text.of(["const a = 1;", "  call(a);", ""]);

  it("maps LSP positions to document positions and back, clamping out-of-range values", () => {
    expect(fromLspPosition(doc, { line: 1, character: 2 })).toBe(15);
    expect(toLspPosition(doc, 15)).toEqual({ line: 1, character: 2 });
    expect(fromLspPosition(doc, { line: 0, character: 99 })).toBe(12);
    expect(fromLspPosition(doc, { line: 9, character: 0 })).toBe(doc.length);
  });

  it("turns text edits into one ordered change set, keeping inserts at the same spot in order", () => {
    const state = EditorState.create({ doc: "a\nb" });
    const changes = lspTextEditsToChanges(state.doc, [
      { range: range(1, 0, 1, 1), newText: "B" },
      { range: range(0, 0, 0, 0), newText: "1" },
      { range: range(0, 0, 0, 0), newText: "2" },
    ]);
    expect(state.update({ changes }).state.doc.toString()).toBe("12a\nB");
  });

  it("only treats real files with a supported language as LSP documents", () => {
    expect(isLspHost({ filePath: "/repo/a.ts", isVirtual: false })).toBe(true);
    expect(isLspHost({ filePath: "/repo/a.ts", isVirtual: true })).toBe(false);
    expect(isLspHost({ filePath: "/repo/a.md", isVirtual: false })).toBe(false);
  });
});

describe("document links", () => {
  const state = EditorState.create({
    doc: 'see https://example.com/docs. and "./notes/readme.md" or "hello world"',
  });

  it("finds a web address under the position without trailing punctuation", () => {
    const link = findDocumentLinkAt(state, 10, "/repo/src/a.ts");
    expect(link?.target).toEqual({ kind: "url", url: "https://example.com/docs" });
    expect(state.sliceDoc(link!.from, link!.to)).toBe("https://example.com/docs");
  });

  it("resolves quoted file paths relative to the source file, but not plain strings", () => {
    const pathStart = state.doc.toString().indexOf("./notes");
    expect(findDocumentLinkAt(state, pathStart + 2, "/repo/src/a.ts")?.target).toEqual({
      kind: "file",
      path: "/repo/src/notes/readme.md",
    });
    const plain = state.doc.toString().indexOf("hello");
    expect(findDocumentLinkAt(state, plain + 1, "/repo/src/a.ts")).toBeNull();
    expect(findDocumentLinkAt(state, pathStart + 2, "")).toBeNull();
  });
});

describe("LSP folding", () => {
  it("folds a server range from the end of its first line to the end of its last line", () => {
    const state = EditorState.create({
      doc: "function a() {\n  one();\n  two();\n}\nconst b = 1;",
      extensions: lspFolding,
    });
    const next = state.update({
      effects: setLspFoldingRanges.of(lspFoldRegions(state.doc, [{ startLine: 0, endLine: 2 }])),
    }).state;
    const first = next.doc.line(1);
    expect(foldable(next, first.from, first.to)).toEqual({
      from: first.to,
      to: next.doc.line(3).to,
    });
    const last = next.doc.line(5);
    expect(foldable(next, last.from, last.to)).toBeNull();
  });

  it("keeps fold regions in place through edits above them", () => {
    const state = EditorState.create({ doc: "a {\n  b\n}", extensions: lspFolding });
    const withRanges = state.update({
      effects: setLspFoldingRanges.of(lspFoldRegions(state.doc, [{ startLine: 0, endLine: 2 }])),
    }).state;
    const edited = withRanges.update({ changes: { from: 0, insert: "x\n" } }).state;
    const line = edited.doc.line(2);
    expect(foldable(edited, line.from, line.to)).toEqual({ from: line.to, to: edited.doc.length });
  });
});

describe("inlay hints and code lenses", () => {
  it("places inlay hints as widgets at their positions", () => {
    const doc = Text.of(["const a = f(1);"]);
    const hints = inlayHintDecorations(doc, [
      { line: 0, character: 7, label: ": number", paddingLeft: false, paddingRight: false },
      { line: 0, character: 12, label: "x:", paddingLeft: false, paddingRight: true },
      { line: 5, character: 0, label: "dropped", paddingLeft: false, paddingRight: false },
    ]);
    const positions: number[] = [];
    hints.between(0, doc.length, (from) => {
      positions.push(from);
    });
    expect(positions).toEqual([7, 12]);
  });

  it("draws one block row per line above it, skipping lenses without a command", () => {
    const doc = Text.of(["class A {", "  m() {}", "}"]);
    const run = vi.fn();
    const decorations = codeLensDecorations(
      doc,
      [
        { line: 1, title: "2 references", command: "editor.action.showReferences" },
        { line: 1, title: "Run", command: "run" },
        { line: 0, title: "label only" },
      ],
      2,
      run,
    );
    const view = new EditorView({
      state: EditorState.create({ doc, extensions: EditorView.decorations.of(decorations) }),
    });
    const rows = view.dom.querySelectorAll(".cm-athas-code-lens");
    expect(rows).toHaveLength(1);
    const items = rows[0]!.querySelectorAll("button");
    expect(Array.from(items, (item) => item.textContent)).toEqual(["2 references", "Run"]);
    expect((rows[0] as HTMLElement).style.paddingLeft).toBe("2ch");
    items[1]!.click();
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ command: "run" }), view);
    view.destroy();
  });

  it("reads the references lens arguments and rejects malformed ones", () => {
    const location = { uri: "file:///repo/a.ts", range: range(1, 2, 1, 3) };
    expect(
      parseShowReferencesArguments(["file:///repo/a.ts", { line: 1, character: 2 }, [location]]),
    ).toEqual({
      uri: "file:///repo/a.ts",
      position: { line: 1, character: 2 },
      locations: [location],
    });
    expect(parseShowReferencesArguments(["file:///repo/a.ts", {}, []])).toBeNull();
    expect(parseShowReferencesArguments(undefined)).toBeNull();
  });
});

describe("selection ranges", () => {
  const doc = Text.of(["foo(bar + baz);"]);
  const chain = {
    range: range(0, 4, 0, 7),
    parent: {
      range: range(0, 4, 0, 7),
      parent: { range: range(0, 4, 0, 13), parent: { range: range(0, 0, 0, 15) } },
    },
  };

  it("flattens the chain innermost first without repeats", () => {
    expect(flattenSelectionRanges(doc, chain)).toEqual([
      { from: 4, to: 7 },
      { from: 4, to: 13 },
      { from: 0, to: 15 },
    ]);
  });

  it("expands to the smallest range strictly containing the selection", () => {
    const ranges = flattenSelectionRanges(doc, chain);
    expect(expandSelectionTarget(ranges, { from: 5, to: 5 })).toEqual({ from: 4, to: 7 });
    expect(expandSelectionTarget(ranges, { from: 4, to: 7 })).toEqual({ from: 4, to: 13 });
    expect(expandSelectionTarget(ranges, { from: 0, to: 15 })).toBeNull();
  });
});

describe("on-type formatting triggers", () => {
  const state = EditorState.create({ doc: "a" });

  it("recognizes typed ; and } and line breaks", () => {
    expect(
      onTypeFormattingTrigger(
        state.update({ changes: { from: 1, insert: ";" }, userEvent: "input.type" }),
      ),
    ).toEqual({ character: ";", position: 2 });
    expect(
      onTypeFormattingTrigger(
        state.update({ changes: { from: 1, insert: "\n  " }, userEvent: "input" }),
      ),
    ).toEqual({ character: "\n", position: 4 });
  });

  it("ignores pastes, formatting edits and other characters", () => {
    expect(
      onTypeFormattingTrigger(
        state.update({ changes: { from: 1, insert: ";" }, userEvent: "input.paste" }),
      ),
    ).toBeNull();
    expect(
      onTypeFormattingTrigger(
        state.update({ changes: { from: 1, insert: ";" }, userEvent: "input.format" }),
      ),
    ).toBeNull();
    expect(
      onTypeFormattingTrigger(
        state.update({ changes: { from: 1, insert: "x" }, userEvent: "input.type" }),
      ),
    ).toBeNull();
  });
});

describe("references peek", () => {
  it("groups locations by file, source file first, in document order without duplicates", () => {
    const { groups, entries } = groupReferenceLocations(
      [
        { uri: "file:///repo/b.ts", range: range(4, 0, 4, 1) },
        { uri: "file:///repo/a.ts", range: range(9, 0, 9, 1) },
        { uri: "file:///repo/z.ts", range: range(1, 0, 1, 1) },
        { uri: "file:///repo/z.ts", range: range(0, 0, 0, 1) },
        { uri: "file:///repo/z.ts", range: range(0, 0, 0, 1) },
      ],
      "/repo/z.ts",
    );
    expect(groups.map((group) => [group.fileName, group.entries.length])).toEqual([
      ["z.ts", 2],
      ["a.ts", 1],
      ["b.ts", 1],
    ]);
    expect(groups[0]!.directory).toBe("/repo");
    expect(entries.map((entry) => entry.location.range.start.line)).toEqual([0, 1, 9, 4]);
    expect(entries.map((entry) => entry.index)).toEqual([0, 1, 2, 3]);
  });

  it("opens under a line, follows edits above it and closes", () => {
    const state = EditorState.create({ doc: "a\nb\nc", extensions: referencesPeekField });
    const mount = () => () => {};
    const opened = state.update({
      effects: openReferencesPeekEffect.of({ anchor: 3, mount, lines: 10 }),
    }).state;
    expect(opened.field(referencesPeekField)?.anchor).toBe(3);
    const edited = opened.update({ changes: { from: 0, insert: "xx" } }).state;
    expect(edited.field(referencesPeekField)?.anchor).toBe(5);
    const closed = edited.update({ effects: closeReferencesPeekEffect.of(null) }).state;
    expect(closed.field(referencesPeekField)).toBeNull();
  });
});

describe("code action groups", () => {
  const action = (id: string, kind?: string, isPreferred = false, disabledReason?: string) => ({
    id,
    title: id,
    kind,
    isPreferred,
    disabledReason,
    hasCommand: false,
    hasEdit: true,
    payload: {},
  });

  it("orders quick fixes, refactors, source actions, then the rest, preferred first", () => {
    const groups = groupCodeActions([
      action("extract", "refactor.extract"),
      action("organize", "source.organizeImports"),
      action("fix", "quickfix"),
      action("best", "quickfix", true),
      action("custom", "custom"),
      action("disabled", "quickfix", false, "nope"),
    ]);
    expect(groups.map((group) => [group.id, group.actions.map((entry) => entry.id)])).toEqual([
      ["quickfix", ["best", "fix"]],
      ["refactor", ["extract"]],
      ["source", ["organize"]],
      ["other", ["custom"]],
    ]);
  });
});
