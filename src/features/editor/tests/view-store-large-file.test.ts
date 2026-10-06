import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { usePaneStore } from "@/features/panes/stores/pane.store";

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

describe("editor view store", () => {
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
    const { useBufferStore } = await import("../stores/buffer.store");
    useBufferStore.setState({
      buffers: [],
      activeBufferId: null,
      pendingClose: null,
      closedBuffersHistory: [],
    });
    vi.unstubAllGlobals();
  });

  it("reads lines from the active buffer only when asked, and follows edits", async () => {
    const { useBufferStore } = await import("../stores/buffer.store");
    const { useEditorViewStore } = await import("../stores/view.store");
    const bufferActions = useBufferStore.getState().actions;
    const content = Array.from({ length: 50_000 }, (_, index) => `line ${index}`).join("\n");

    const bufferId = bufferActions.openContent({
      type: "editor",
      path: "/workspace/sqlite.c",
      name: "sqlite.c",
      content: "",
    });
    bufferActions.updateBufferContent(bufferId, content);

    const { actions } = useEditorViewStore.getState();
    expect(actions.getLineCount()).toBe(50_000);
    expect(actions.getLines()[49_999]).toBe("line 49999");
    expect(actions.getLines()).toBe(actions.getLines());

    bufferActions.updateBufferContent(bufferId, "a\nb");
    expect(actions.getLineCount()).toBe(2);
    expect(actions.getLines()).toEqual(["a", "b"]);
    expect(actions.getContent()).toBe("a\nb");
  });
});
