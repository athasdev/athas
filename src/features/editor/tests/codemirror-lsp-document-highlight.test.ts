// @vitest-environment jsdom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("@/extensions/registry/extension-registry", () => ({
  extensionRegistry: { isLspSupported: () => true },
}));
vi.mock("@/features/editor/lsp/services/lsp-client", () => ({
  LspClient: { getInstance: () => ({}) },
}));
vi.mock("@/features/settings/stores/settings.store", () => ({
  useSettingsStore: (selector: (state: unknown) => unknown) =>
    selector({ settings: { highlightOccurrences: true } }),
}));

const { documentHighlightExtension } =
  await import("../engines/codemirror/features/lsp-document-highlight");

let view: EditorView | null = null;

afterEach(() => {
  view?.destroy();
  view = null;
});

describe("CodeMirror document highlight", () => {
  it("highlights the occurrences the server reports with their read and write kinds", async () => {
    const client = {
      getDocumentHighlights: vi.fn(async () => [
        {
          range: { start: { line: 0, character: 4 }, end: { line: 0, character: 5 } },
          kind: 3 as const,
        },
        {
          range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } },
          kind: 2 as const,
        },
      ]),
    };
    view = new EditorView({
      state: EditorState.create({
        doc: "let a = 1;\na + 1;",
        selection: { anchor: 4 },
        extensions: documentHighlightExtension("/repo/a.ts", client, 5),
      }),
      parent: document.body,
    });

    await vi.waitFor(() =>
      expect(view!.dom.querySelectorAll(".cm-athas-documentHighlight")).toHaveLength(2),
    );
    expect(client.getDocumentHighlights).toHaveBeenCalledWith("/repo/a.ts", 0, 4);
    expect(view.dom.querySelector(".cm-athas-documentHighlight-write")?.textContent).toBe("a");
    expect(view.dom.querySelector(".cm-athas-documentHighlight-read")?.textContent).toBe("a");

    client.getDocumentHighlights.mockResolvedValue([]);
    view.dispatch({ selection: { anchor: 8 } });
    await vi.waitFor(() =>
      expect(view!.dom.querySelectorAll(".cm-athas-documentHighlight")).toHaveLength(0),
    );
    expect(client.getDocumentHighlights).toHaveBeenLastCalledWith("/repo/a.ts", 0, 8);
  });

  it("skips selections spanning lines", async () => {
    const client = { getDocumentHighlights: vi.fn(async () => []) };
    view = new EditorView({
      state: EditorState.create({
        doc: "a\nb",
        selection: { anchor: 0, head: 3 },
        extensions: documentHighlightExtension("/repo/a.ts", client, 5),
      }),
      parent: document.body,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(client.getDocumentHighlights).not.toHaveBeenCalled();
  });
});
