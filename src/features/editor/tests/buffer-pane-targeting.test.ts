import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ROOT_PANE_ID } from "@/features/panes/constants/pane";
import { getActiveBufferId } from "@/features/panes/stores/pane-selectors";
import { usePaneStore } from "@/features/panes/stores/pane.store";
import { getAllPaneGroups } from "@/features/panes/services/pane-tree";

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
    clear: () => storage.clear(),
    key: (index: number) => Array.from(storage.keys())[index] ?? null,
    get length() {
      return storage.size;
    },
  };
};

const editor = (name: string, isPreview = false) => ({
  type: "editor" as const,
  path: `/workspace/${name}`,
  name,
  content: name,
  isPreview,
});

async function loadBufferStore() {
  const { useBufferStore } = await import("../stores/buffer.store");
  return useBufferStore;
}

function panesHolding(bufferId: string) {
  const { root, bottomRoot } = usePaneStore.getState();
  return [...getAllPaneGroups(root), ...getAllPaneGroups(bottomRoot)]
    .filter((pane) => pane.bufferIds.includes(bufferId))
    .map((pane) => pane.id);
}

describe("buffer pane targeting", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMockStorage());
    vi.stubGlobal("window", {
      __TAURI_INTERNALS__: {
        invoke: vi.fn().mockResolvedValue([]),
        metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });
  });

  afterEach(async () => {
    usePaneStore.getState().actions.reset();
    const useBufferStore = await loadBufferStore();
    useBufferStore.setState({ buffers: [], pendingClose: null, closedBuffersHistory: [] });
    vi.unstubAllGlobals();
  });

  it("closing the last tab of the focused split keeps the other pane's active tab", async () => {
    const useBufferStore = await loadBufferStore();
    const actions = useBufferStore.getState().actions;
    const y = actions.openContent(editor("y.ts"));
    const z = actions.openContent(editor("z.ts"));
    const splitPaneId = usePaneStore.getState().actions.splitPane(ROOT_PANE_ID, "horizontal");
    const x = actions.openContent(editor("x.ts"));
    expect(panesHolding(x)).toEqual([splitPaneId]);
    expect(getActiveBufferId()).toBe(x);

    actions.closeBufferForce(x);

    const rootPane = usePaneStore.getState().actions.getPaneById(ROOT_PANE_ID);
    expect(rootPane?.bufferIds).toEqual([y, z]);
    expect(rootPane?.activeBufferId).toBe(z);
    expect(usePaneStore.getState().activePaneId).toBe(ROOT_PANE_ID);
    expect(getActiveBufferId()).toBe(z);
  });

  it("opens a dropped terminal only in the target pane, not the focused one", async () => {
    const useBufferStore = await loadBufferStore();
    const actions = useBufferStore.getState().actions;
    actions.openContent(editor("a.ts"));
    const rightPaneId = usePaneStore.getState().actions.splitPane(ROOT_PANE_ID, "horizontal");
    expect(rightPaneId).not.toBeNull();
    if (!rightPaneId) return;
    actions.openContent(editor("b.ts"));
    usePaneStore.getState().actions.setActivePane(ROOT_PANE_ID);

    const terminalId = actions.openTerminalBuffer(
      { sessionId: "session-1", name: "Terminal" },
      { paneId: rightPaneId },
    );

    expect(panesHolding(terminalId)).toEqual([rightPaneId]);
    expect(usePaneStore.getState().activePaneId).toBe(rightPaneId);
    expect(getActiveBufferId()).toBe(terminalId);
  });

  it("opens a dropped file only in the target pane and replaces that pane's preview", async () => {
    const useBufferStore = await loadBufferStore();
    const actions = useBufferStore.getState().actions;
    const rootPreview = actions.openContent(editor("a.ts", true));
    const rightPaneId = usePaneStore.getState().actions.splitPane(ROOT_PANE_ID, "horizontal");
    expect(rightPaneId).not.toBeNull();
    if (!rightPaneId) return;
    const rightPreview = actions.openContent(editor("b.ts", true));
    expect(usePaneStore.getState().activePaneId).toBe(rightPaneId);

    const dropped = actions.openContent(editor("c.ts", true), { paneId: ROOT_PANE_ID });

    expect(panesHolding(dropped)).toEqual([ROOT_PANE_ID]);
    expect(useBufferStore.getState().buffers.map((buffer) => buffer.id)).toEqual([
      rightPreview,
      dropped,
    ]);
    expect(panesHolding(rootPreview)).toEqual([]);
    expect(usePaneStore.getState().activePaneId).toBe(ROOT_PANE_ID);
  });
});
