import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { CompletionItem } from "vscode-languageserver-protocol";
import { useLspStore } from "../lsp/lsp-store";
import { useEditorUIStore } from "../stores/ui-store";

describe("lsp store completions", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    useEditorUIStore.setState({
      filteredCompletions: [],
      isLspCompletionVisible: false,
      selectedLspIndex: 0,
      currentPrefix: "",
      isApplyingCompletion: false,
    });
    useLspStore.setState({
      getCompletions: undefined,
      isLanguageSupported: undefined,
      currentCompletionRequest: null,
      completionCache: {},
    });
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
