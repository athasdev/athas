import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ROOT_PANE_ID } from "../constants/pane";
import { usePaneStore } from "../stores/pane-store";
import { getAllPaneGroups } from "../utils/pane-tree";

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

describe("pane split actions", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMockStorage());
  });

  afterEach(() => {
    usePaneStore.getState().actions.reset();
    vi.unstubAllGlobals();
  });

  it("creates an adjacent pane and activates it", async () => {
    const { createPaneBeside } = await import("../utils/pane-split-actions");

    const paneId = createPaneBeside(ROOT_PANE_ID, "horizontal");

    expect(paneId).not.toBeNull();
    expect(getAllPaneGroups(usePaneStore.getState().root)).toHaveLength(2);
    expect(usePaneStore.getState().activePaneId).toBe(paneId);
  });

  it("can seed the adjacent pane with a shared buffer", async () => {
    const { createPaneBeside } = await import("../utils/pane-split-actions");
    const paneActions = usePaneStore.getState().actions;

    paneActions.addBufferToPane(ROOT_PANE_ID, "buffer-a");

    const paneId = createPaneBeside(ROOT_PANE_ID, "horizontal", "after", "buffer-a");

    expect(paneId).not.toBeNull();
    if (!paneId) return;
    expect(paneActions.getPaneById(paneId)?.bufferIds).toEqual(["buffer-a"]);
  });
});
