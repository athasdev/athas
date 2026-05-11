import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { usePaneStore } from "@/features/panes/stores/pane-store";

const createMockStorage = () => {
  const storage = new Map<string, string>();

  return {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
    clear: () => {
      storage.clear();
    },
    key: (index: number) => Array.from(storage.keys())[index] ?? null,
    get length() {
      return storage.size;
    },
  };
};

describe("editor view store large files", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMockStorage());
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
  });

  afterEach(async () => {
    usePaneStore.getState().actions.reset();
    const { useBufferStore } = await import("../stores/buffer-store");
    const { useEditorViewStore } = await import("../stores/view-store");
    useBufferStore.setState({
      buffers: [],
      activeBufferId: null,
      pendingClose: null,
      closedBuffersHistory: [],
    });
    useEditorViewStore.setState({
      lines: [""],
      lineCount: 1,
      lineTokens: new Map(),
    });
    vi.unstubAllGlobals();
  });

  it("tracks large active buffers by line count without storing every line", async () => {
    const { useBufferStore } = await import("../stores/buffer-store");
    const { useEditorViewStore } = await import("../stores/view-store");
    const bufferActions = useBufferStore.getState().actions;
    const content = Array.from({ length: 50_000 }, (_, index) => `line ${index}`).join("\n");

    const bufferId = bufferActions.openContent({
      type: "editor",
      path: "/workspace/sqlite.c",
      name: "sqlite.c",
      content: "",
    });

    bufferActions.updateBufferContent(bufferId, content);

    const viewState = useEditorViewStore.getState();
    expect(viewState.lineCount).toBe(50_000);
    expect(viewState.lines).toHaveLength(50_000);
    expect(Object.keys(viewState.lines)).toHaveLength(0);
    expect(useEditorViewStore.getState().actions.getLines()).toHaveLength(50_000);
  });

  it("updates cached lines incrementally for small typing edits", async () => {
    const { applyIncrementalLineEdit } = await import("../stores/view-store");
    const previousContent = "first line\nsecond line\nthird line";
    const previousLines = previousContent.split("\n");

    expect(
      applyIncrementalLineEdit(
        previousContent,
        "first line\nsecond fast line\nthird line",
        previousLines,
      ),
    ).toEqual(["first line", "second fast line", "third line"]);

    expect(
      applyIncrementalLineEdit(
        previousContent,
        "first line\nsecond line\ninserted\nthird line",
        previousLines,
      ),
    ).toEqual(["first line", "second line", "inserted", "third line"]);

    expect(
      applyIncrementalLineEdit(previousContent, "first line\nthird line", previousLines),
    ).toEqual(["first line", "third line"]);

    expect(
      applyIncrementalLineEdit(previousContent, `x${".".repeat(1001)}`, previousLines),
    ).toBeNull();
  });

  it("matches full line rebuild for boundary edits", async () => {
    const { applyIncrementalLineEdit } = await import("../stores/view-store");
    const cases = [
      ["alpha\nbeta\ngamma", "xalpha\nbeta\ngamma"],
      ["alpha\nbeta\ngamma", "alpha\nxbeta\ngamma"],
      ["alpha\nbeta\ngamma", "alpha\nbeta\ngammax"],
      ["alpha\nbeta\ngamma", "alpha\nbeta\n\ngamma"],
      ["alpha\nbeta\ngamma", "alpha\nbe\nta\ngamma"],
      ["alpha\nbeta\ngamma\n", "alpha\nbeta\ngamma\nx"],
      ["alpha\nbeta\ngamma", "alpha\nbeta"],
    ];

    for (const [previousContent, nextContent] of cases) {
      expect(
        applyIncrementalLineEdit(previousContent, nextContent, previousContent.split("\n")),
      ).toEqual(nextContent.split("\n"));
    }
  });
});
