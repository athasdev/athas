import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ROOT_PANE_ID } from "../constants/pane";
import { usePaneStore } from "../stores/pane-store";

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

describe("pane activation", () => {
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
    const { useBufferStore } = await import("@/features/editor/stores/buffer-store");
    useBufferStore.setState({
      buffers: [],
      activeBufferId: null,
      pendingClose: null,
      closedBuffersHistory: [],
    });
    vi.unstubAllGlobals();
  });

  it("activates pane and buffer stores together", async () => {
    const { useBufferStore } = await import("@/features/editor/stores/buffer-store");
    const { activateBufferInPaneAndSync } = await import("../utils/pane-activation");
    const paneActions = usePaneStore.getState().actions;

    useBufferStore.setState((state) => ({
      ...state,
      buffers: [
        {
          id: "buffer-a",
          type: "editor",
          path: "/workspace/a.ts",
          name: "a.ts",
          isPinned: false,
          isPreview: false,
          isActive: false,
          content: "",
          savedContent: "",
          isDirty: false,
          isVirtual: false,
          tokens: [],
        },
      ],
      activeBufferId: null,
    }));
    paneActions.addBufferToPane(ROOT_PANE_ID, "buffer-a", false);

    activateBufferInPaneAndSync(ROOT_PANE_ID, "buffer-a");

    expect(paneActions.getPaneById(ROOT_PANE_ID)?.activeBufferId).toBe("buffer-a");
    expect(usePaneStore.getState().activePaneId).toBe(ROOT_PANE_ID);
    expect(useBufferStore.getState().activeBufferId).toBe("buffer-a");
  });
});
