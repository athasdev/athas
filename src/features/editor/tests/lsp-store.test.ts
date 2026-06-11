import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { CompletionItem } from "vscode-languageserver-protocol";
import type { useLspStore as useLspStoreHook } from "../lsp/stores/lsp.store";
import type { useEditorUIStore as useEditorUIStoreHook } from "../stores/ui.store";

type LspStoreHook = typeof useLspStoreHook;
type EditorUIStoreHook = typeof useEditorUIStoreHook;

describe("lsp store completions", () => {
  let useLspStore: LspStoreHook;
  let useEditorUIStore: EditorUIStoreHook;

  beforeEach(async () => {
    vi.stubGlobal("window", {
      __TAURI_INTERNALS__: {
        invoke: vi.fn().mockResolvedValue([]),
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main" },
        },
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });

    ({ useLspStore } = await import("../lsp/stores/lsp.store"));
    ({ useEditorUIStore } = await import("../stores/ui.store"));
  });

  afterEach(() => {
    useEditorUIStore?.setState({
      filteredCompletions: [],
      isLspCompletionVisible: false,
      selectedLspIndex: 0,
      currentPrefix: "",
      isApplyingCompletion: false,
    });
    useLspStore?.setState({
      getCompletions: undefined,
      isLanguageSupported: undefined,
      currentCompletionRequest: null,
      completionCache: {},
    });
    vi.unstubAllGlobals();
  });

  it("shows unfiltered completions for a manual empty-prefix request", async () => {
    const completions: CompletionItem[] = [{ label: "alpha" }, { label: "beta" }];
    const getCompletions = vi.fn(async () => completions);

    useLspStore.getState().actions.setCompletionHandlers(getCompletions, () => true);

    await useLspStore.getState().actions.performCompletionRequest({
      filePath: "/tmp/manual.ts",
      cursorPos: 0,
      value: "",
      editorRef: { current: {} as HTMLDivElement },
      manual: true,
    });

    expect(getCompletions).toHaveBeenCalledWith("/tmp/manual.ts", 0, 0);
    expect(useEditorUIStore.getState().isLspCompletionVisible).toBe(true);
    expect(useEditorUIStore.getState().filteredCompletions).toEqual([
      { item: { label: "alpha" }, score: 1, indices: [] },
      { item: { label: "beta" }, score: 1, indices: [] },
    ]);
  });
});
