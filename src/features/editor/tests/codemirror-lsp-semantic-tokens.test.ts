// @vitest-environment jsdom
import { EditorState, type Extension, Text } from "@codemirror/state";
import { type DecorationSet, EditorView, type ViewPlugin } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  lspListeners: new Set<(state: unknown, previous: unknown) => void>(),
}));

vi.mock("@/extensions/registry/extension-registry", () => ({
  extensionRegistry: { isLspSupported: () => true },
}));
vi.mock("@/features/editor/lsp/lsp-client", () => ({ LspClient: { getInstance: () => ({}) } }));
vi.mock("@/features/settings/stores/settings.store", () => ({
  useSettingsStore: (selector: (state: unknown) => unknown) =>
    selector({ settings: { semanticTokens: true } }),
}));
vi.mock("@/features/editor/lsp/stores/lsp.store", () => ({
  useLspStore: {
    subscribe: (listener: (state: unknown, previous: unknown) => void) => {
      mocks.lspListeners.add(listener);
      return () => mocks.lspListeners.delete(listener);
    },
  },
}));

const {
  decodeSemanticTokens,
  forEachSemanticTokenRange,
  semanticTokenRanges,
  toStandardSemanticTokenType,
} = await import("../engines/codemirror/lsp/semantic-token-styles");
const { semanticTokensExtension } =
  await import("../engines/codemirror/features/lsp-semantic-tokens");

const legend = {
  tokenTypes: ["variable", "function", "builtinType", "unknownThing"],
  tokenModifiers: ["declaration", "readonly", "deprecated"],
};

let view: EditorView | null = null;

afterEach(() => {
  view?.destroy();
  view = null;
});

describe("CodeMirror semantic tokens", () => {
  it("folds server token names into the standard legend", () => {
    expect(toStandardSemanticTokenType("function")).toBe("function");
    expect(toStandardSemanticTokenType("builtinType")).toBe("type");
    expect(toStandardSemanticTokenType("enum_member")).toBe("enumMember");
    expect(toStandardSemanticTokenType("field")).toBe("property");
    expect(toStandardSemanticTokenType("nonsense")).toBeUndefined();
  });

  it("decodes relative tokens into classed ranges, clamped and without overlaps", () => {
    const doc = Text.of(["const value = make();", "x"]);
    const ranges = semanticTokenRanges(
      {
        ...legend,
        // value (readonly variable), make (function), overlapping, unknown type, past line end,
        // next line deprecated function, then a line past the document.
        data: Uint32Array.from([
          0, 6, 5, 0, 2, 0, 8, 4, 1, 0, 0, 1, 2, 1, 0, 0, 6, 1, 3, 0, 0, 30, 3, 1, 0, 1, 0, 9, 1, 4,
          5, 0, 1, 1, 0,
        ]),
      },
      doc,
    );
    expect(ranges).toEqual([
      { from: 6, to: 11, className: "cm-athas-semantic-constant" },
      { from: 14, to: 18, className: "cm-athas-semantic-function" },
      { from: 22, to: 23, className: "cm-athas-semantic-function cm-athas-semantic-deprecated" },
    ]);
  });

  it("decorates the document, maps decorations through edits and refreshes after typing", async () => {
    const client = {
      getActiveServerEntryForFile: () => ({}),
      isDocumentOpen: () => true,
      getSemanticTokens: vi.fn(async () => ({
        ...legend,
        data: Uint32Array.from([0, 0, 4, 1, 0]),
      })),
    };
    view = new EditorView({
      state: EditorState.create({
        doc: "make()",
        extensions: semanticTokensExtension("/repo/a.ts", client, 5),
      }),
      parent: document.body,
    });
    await vi.waitFor(() =>
      expect(view!.dom.querySelector(".cm-athas-semantic-function")?.textContent).toBe("make"),
    );

    view.dispatch({ changes: { from: 0, insert: "  " } });
    expect(view.dom.querySelector(".cm-athas-semantic-function")?.textContent).toBe("make");
    await vi.waitFor(() => expect(client.getSemanticTokens).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(view!.dom.querySelector(".cm-athas-semantic-function")?.textContent).toBe("  ma"),
    );
  });

  it("builds ranges for a slice of lines exactly as the full pass does", () => {
    const lines = Array.from({ length: 50 }, (_, index) => `let v${index} = f(v${index});`);
    const doc = Text.of(lines);
    const data: number[] = [];
    for (let line = 0; line < lines.length; line += 1) {
      data.push(line === 0 ? 0 : 1, 4, 3, 0, line % 3 === 0 ? 2 : 0);
      data.push(0, 2, 4, 1, line % 5 === 0 ? 4 : 0);
      data.push(0, 1, 2, 1, 0);
    }
    const response = { ...legend, data: Uint32Array.from(data) };
    const full = semanticTokenRanges(response, doc);
    const decoded = decodeSemanticTokens(response);
    const slice: { from: number; to: number; className: string }[] = [];
    forEachSemanticTokenRange(decoded, doc, 10, 19, (from, to, className) =>
      slice.push({ from, to, className }),
    );
    const sliceFrom = doc.line(11).from;
    const sliceTo = doc.line(20).to;
    expect(slice).toEqual(full.filter((range) => range.from >= sliceFrom && range.to <= sliceTo));
    expect(slice.length).toBe(20);
  });

  it("decorates only around the visible ranges and rebuilds through pending edits", async () => {
    const lineCount = 5000;
    const data: number[] = [];
    for (let line = 0; line < lineCount; line += 1) data.push(line === 0 ? 0 : 1, 0, 4, 1, 0);
    const client = {
      getActiveServerEntryForFile: () => ({}),
      isDocumentOpen: () => true,
      getSemanticTokens: vi.fn(async () => ({ ...legend, data: Uint32Array.from(data) })),
    };
    const extension = semanticTokensExtension("/repo/a.ts", client, 10_000) as Extension[];
    view = new EditorView({
      state: EditorState.create({
        doc: Array.from({ length: lineCount }, () => "make()").join("\n"),
        extensions: extension,
      }),
      parent: document.body,
    });
    const plugin = extension[0] as ViewPlugin<{ decorations: DecorationSet }>;
    const decorationsOf = () => {
      const ranges: { from: number; to: number }[] = [];
      view!.plugin(plugin)!.decorations.between(0, view!.state.doc.length, (from, to) => {
        ranges.push({ from, to });
      });
      return ranges;
    };
    await vi.waitFor(() => expect(decorationsOf().length).toBeGreaterThan(0));
    expect(decorationsOf().length).toBeLessThan(lineCount / 2);

    const doc = view.state.doc;
    const lastLine = doc.line(lineCount);
    Object.defineProperty(view, "visibleRanges", {
      configurable: true,
      get: () => [{ from: doc.line(lineCount - 10).from, to: view!.state.doc.length }],
    });
    view.dispatch({ changes: { from: lastLine.from, insert: "  " } });

    const ranges = decorationsOf();
    expect(ranges[ranges.length - 1]).toEqual({ from: lastLine.from + 2, to: lastLine.from + 6 });
    expect(ranges.some((range) => range.from < doc.line(100).from)).toBe(false);
  });

  it("keeps the built window when typing at the end of the document", async () => {
    const client = {
      getActiveServerEntryForFile: () => ({}),
      isDocumentOpen: () => true,
      getSemanticTokens: vi.fn(async () => ({
        ...legend,
        data: Uint32Array.from([0, 0, 4, 1, 0]),
      })),
    };
    const extension = semanticTokensExtension("/repo/a.ts", client, 10_000) as Extension[];
    view = new EditorView({
      state: EditorState.create({ doc: "make()", extensions: extension }),
      parent: document.body,
    });
    const plugin = extension[0] as ViewPlugin<{ decorations: DecorationSet }>;
    await vi.waitFor(() => expect(view!.plugin(plugin)!.decorations.size).toBe(1));

    let visibleRangeReads = 0;
    Object.defineProperty(view, "visibleRanges", {
      configurable: true,
      get: () => {
        visibleRangeReads += 1;
        return [{ from: 0, to: view!.state.doc.length }];
      },
    });
    for (const character of "abc") {
      view.dispatch({ changes: { from: view.state.doc.length, insert: character } });
    }

    expect(visibleRangeReads).toBe(3);
    expect(view.dom.querySelector(".cm-athas-semantic-function")?.textContent).toBe("make");
  });

  it("waits before retrying a failed request for the same text", async () => {
    const client = {
      getActiveServerEntryForFile: () => ({}),
      isDocumentOpen: () => true,
      getSemanticTokens: vi.fn(async () => null),
    };
    view = new EditorView({
      state: EditorState.create({
        doc: "make()",
        extensions: semanticTokensExtension("/repo/a.ts", client, 5),
      }),
      parent: document.body,
    });
    await vi.waitFor(() => expect(client.getSemanticTokens).toHaveBeenCalledTimes(1));
    for (const listener of mocks.lspListeners) {
      listener(
        { lspStatus: { status: "connected", documentRevision: 1 } },
        { lspStatus: { status: "connecting", documentRevision: 0 } },
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(client.getSemanticTokens).toHaveBeenCalledTimes(1);
  });
});
