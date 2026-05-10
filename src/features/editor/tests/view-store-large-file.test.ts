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
});
