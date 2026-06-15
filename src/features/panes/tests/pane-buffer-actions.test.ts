import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ROOT_PANE_ID } from "../constants/pane";
import { usePaneStore } from "../stores/pane.store";

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

describe("pane buffer actions", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMockStorage());
  });

  afterEach(() => {
    usePaneStore.getState().actions.reset();
    vi.unstubAllGlobals();
  });

  it("adds missing buffers to an existing pane", async () => {
    const { ensureBufferInPane } = await import("../utils/pane-buffer-actions");

    expect(ensureBufferInPane(ROOT_PANE_ID, "buffer-a")).toBe(ROOT_PANE_ID);
    expect(usePaneStore.getState().actions.getPaneById(ROOT_PANE_ID)?.bufferIds).toEqual([
      "buffer-a",
    ]);
    expect(usePaneStore.getState().activePaneId).toBe(ROOT_PANE_ID);
  });

  it("activates existing buffers without duplicating them", async () => {
    const { ensureBufferInPane } = await import("../utils/pane-buffer-actions");
    const paneActions = usePaneStore.getState().actions;

    paneActions.addBufferToPane(ROOT_PANE_ID, "buffer-a");
    paneActions.addBufferToPane(ROOT_PANE_ID, "buffer-b");

    expect(ensureBufferInPane(ROOT_PANE_ID, "buffer-a")).toBe(ROOT_PANE_ID);
    expect(paneActions.getPaneById(ROOT_PANE_ID)?.bufferIds).toEqual(["buffer-a", "buffer-b"]);
    expect(paneActions.getPaneById(ROOT_PANE_ID)?.activeBufferId).toBe("buffer-a");
  });

  it("returns null for missing panes", async () => {
    const { ensureBufferInPane } = await import("../utils/pane-buffer-actions");

    expect(ensureBufferInPane("missing-pane", "buffer-a")).toBeNull();
  });
});
