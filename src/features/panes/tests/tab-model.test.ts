import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ROOT_PANE_ID } from "../constants/pane";
import {
  getActiveBufferId,
  isBufferPinned,
  isBufferPreview,
  selectPaneBufferFlags,
} from "../stores/pane-selectors";
import { usePaneStore } from "../stores/pane.store";
import { getAllPaneGroups } from "../services/pane-tree";

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

async function loadBufferStore() {
  const { useBufferStore } = await import("@/features/editor/stores/buffer.store");
  return useBufferStore;
}

function paneBufferIds() {
  const { root, bottomRoot } = usePaneStore.getState();
  return [...getAllPaneGroups(root), ...getAllPaneGroups(bottomRoot)].flatMap(
    (pane) => pane.bufferIds,
  );
}

/**
 * Records every notification of either store and checks that panes only ever point at buffers
 * the registry holds at that moment.
 */
async function watchStores() {
  const useBufferStore = await loadBufferStore();
  const counts = { buffer: 0, pane: 0 };
  const violations: string[] = [];
  const check = () => {
    const ids = new Set(useBufferStore.getState().buffers.map((buffer) => buffer.id));
    for (const bufferId of paneBufferIds()) {
      if (!ids.has(bufferId)) violations.push(bufferId);
    }
  };
  const unsubscribeBuffers = useBufferStore.subscribe(() => {
    counts.buffer += 1;
    check();
  });
  const unsubscribePanes = usePaneStore.subscribe(() => {
    counts.pane += 1;
    check();
  });
  return {
    counts,
    violations,
    reset: () => {
      counts.buffer = 0;
      counts.pane = 0;
    },
    stop: () => {
      unsubscribeBuffers();
      unsubscribePanes();
    },
  };
}

const editor = (name: string, isPreview = false) => ({
  type: "editor" as const,
  path: `/workspace/${name}`,
  name,
  content: name,
  isPreview,
});

describe("unified tab model", () => {
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

  it("opens a buffer with one registry and one layout update, never out of step", async () => {
    const useBufferStore = await loadBufferStore();
    const watcher = await watchStores();

    const id = useBufferStore.getState().actions.openContent(editor("a.ts"));

    expect(watcher.counts).toEqual({ buffer: 1, pane: 1 });
    expect(watcher.violations).toEqual([]);
    expect(getActiveBufferId()).toBe(id);
    watcher.stop();
  });

  it("replaces a preview tab without a pane ever pointing at a missing buffer", async () => {
    const useBufferStore = await loadBufferStore();
    const actions = useBufferStore.getState().actions;
    const first = actions.openContent(editor("a.ts", true));
    const watcher = await watchStores();

    const second = actions.openContent(editor("b.ts", true));

    expect(watcher.violations).toEqual([]);
    expect(watcher.counts.pane).toBe(1);
    expect(useBufferStore.getState().buffers.map((buffer) => buffer.id)).toEqual([second]);
    expect(usePaneStore.getState().actions.getPaneById(ROOT_PANE_ID)?.previewBufferId).toBe(second);
    expect(isBufferPreview(first)).toBe(false);
    watcher.stop();
  });

  it("activates, pins and promotes tabs through the layout alone", async () => {
    const useBufferStore = await loadBufferStore();
    const actions = useBufferStore.getState().actions;
    const a = actions.openContent(editor("a.ts"));
    const b = actions.openContent(editor("b.ts", true));
    const watcher = await watchStores();

    actions.setActiveBuffer(a);
    expect(watcher.counts).toEqual({ buffer: 0, pane: 1 });
    expect(getActiveBufferId()).toBe(a);

    watcher.reset();
    actions.handleTabPin(b);
    expect(watcher.counts).toEqual({ buffer: 0, pane: 1 });
    expect(isBufferPinned(b)).toBe(true);
    expect(isBufferPreview(b)).toBe(false);

    watcher.reset();
    actions.handleTabPin(b);
    expect(isBufferPinned(b)).toBe(false);
    expect(watcher.counts).toEqual({ buffer: 0, pane: 1 });
    watcher.stop();
  });

  it("promotes a preview tab when its text is edited", async () => {
    const useBufferStore = await loadBufferStore();
    const actions = useBufferStore.getState().actions;
    const preview = actions.openContent(editor("a.ts", true));
    expect(isBufferPreview(preview)).toBe(true);

    actions.updateBufferContent(preview, "edited");

    expect(isBufferPreview(preview)).toBe(false);
    expect(usePaneStore.getState().actions.getPaneById(ROOT_PANE_ID)?.bufferIds).toEqual([preview]);
  });

  it("closes a tab from the layout first and keeps a pin for reopening", async () => {
    const useBufferStore = await loadBufferStore();
    const actions = useBufferStore.getState().actions;
    const a = actions.openContent(editor("a.ts"));
    const b = actions.openContent(editor("b.ts"));
    actions.handleTabPin(b);
    const watcher = await watchStores();

    actions.closeBufferForce(b);

    expect(watcher.violations).toEqual([]);
    expect(watcher.counts).toEqual({ buffer: 1, pane: 1 });
    expect(getActiveBufferId()).toBe(a);
    expect(useBufferStore.getState().closedBuffersHistory[0]).toMatchObject({
      path: "/workspace/b.ts",
      isPinned: true,
    });
    watcher.stop();
  });

  it("never evicts pinned tabs", async () => {
    const useBufferStore = await loadBufferStore();
    const actions = useBufferStore.getState().actions;
    const previousMaxOpenTabs = useBufferStore.getState().maxOpenTabs;
    actions.setMaxOpenTabs(2);
    const a = actions.openContent(editor("a.ts"));
    actions.handleTabPin(a);
    const b = actions.openContent(editor("b.ts"));
    actions.openContent(editor("c.ts"));
    actions.openContent(editor("d.ts"));

    const ids = useBufferStore.getState().buffers.map((buffer) => buffer.id);
    expect(ids).toContain(a);
    expect(ids).not.toContain(b);
    expect(paneBufferIds().every((id) => ids.includes(id))).toBe(true);
    actions.setMaxOpenTabs(previousMaxOpenTabs);
  });

  it("carries a pin across panes and splits, and promotes a moved preview", async () => {
    const useBufferStore = await loadBufferStore();
    const actions = useBufferStore.getState().actions;
    const paneActions = usePaneStore.getState().actions;
    const pinned = actions.openContent(editor("pinned.ts"));
    actions.handleTabPin(pinned);
    const preview = actions.openContent(editor("preview.ts", true));

    const rightPaneId = paneActions.splitPane(ROOT_PANE_ID, "horizontal", pinned);
    expect(rightPaneId).not.toBeNull();
    if (!rightPaneId) return;
    expect(paneActions.getPaneById(rightPaneId)?.pinnedBufferIds).toEqual([pinned]);

    paneActions.moveBufferToPane(preview, ROOT_PANE_ID, rightPaneId);
    expect(paneActions.getPaneById(rightPaneId)?.bufferIds).toEqual([pinned, preview]);
    expect(isBufferPreview(preview)).toBe(false);
    expect(getActiveBufferId()).toBe(preview);

    const flags = selectPaneBufferFlags(usePaneStore.getState());
    expect([...flags.pinnedBufferIds]).toEqual([pinned]);
  });

  it("keeps tab order per pane and closes to the right in that order", async () => {
    const useBufferStore = await loadBufferStore();
    const actions = useBufferStore.getState().actions;
    const a = actions.openContent(editor("a.ts"));
    const b = actions.openContent(editor("b.ts"));
    const c = actions.openContent(editor("c.ts"));

    usePaneStore.getState().actions.moveBufferInPane(ROOT_PANE_ID, c, a);
    expect(usePaneStore.getState().actions.getPaneById(ROOT_PANE_ID)?.bufferIds).toEqual([c, a, b]);

    actions.handleCloseTabsToRight(a);
    expect(useBufferStore.getState().buffers.map((buffer) => buffer.id)).toEqual([a, c]);
  });

  it("derives the active buffer from the last focused pane when the focused one is empty", async () => {
    const useBufferStore = await loadBufferStore();
    const a = useBufferStore.getState().actions.openContent(editor("a.ts"));
    usePaneStore.getState().actions.splitPane(ROOT_PANE_ID, "horizontal");

    expect(usePaneStore.getState().actions.getActivePane()?.bufferIds).toEqual([]);
    expect(getActiveBufferId()).toBe(a);
  });
});
