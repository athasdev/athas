// @vitest-environment jsdom
import { EditorState, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
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

const { semanticTokenRanges, toStandardSemanticTokenType } =
  await import("../engines/codemirror/lsp/semantic-token-styles");
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
