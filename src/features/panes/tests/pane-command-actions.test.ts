import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { BOTTOM_PANE_ID, ROOT_PANE_ID } from "../constants/pane";
import { usePaneStore } from "../stores/pane.store";
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

describe("pane command actions", () => {
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
    const { useBufferStore } = await import("@/features/editor/stores/buffer.store");
    useBufferStore.setState({
      buffers: [],
      activeBufferId: null,
      pendingClose: null,
      closedBuffersHistory: [],
    });
    vi.unstubAllGlobals();
  });

  it("splits the active editor group with an editor buffer", async () => {
    const { useBufferStore } = await import("@/features/editor/stores/buffer.store");
    const { splitActiveEditorGroup } = await import("../utils/pane-command-actions");
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
          isActive: true,
          content: "",
          savedContent: "",
          isDirty: false,
          isVirtual: false,
          tokens: [],
        },
      ],
      activeBufferId: "buffer-a",
    }));
    paneActions.addBufferToPane(ROOT_PANE_ID, "buffer-a");

    expect(splitActiveEditorGroup("horizontal")).toBe(true);

    const groups = getAllPaneGroups(usePaneStore.getState().root);
    expect(groups).toHaveLength(2);
    expect(groups.every((pane) => pane.bufferIds.includes("buffer-a"))).toBe(true);
  });

  it("splits stateful buffers into an empty editor group", async () => {
    const { useBufferStore } = await import("@/features/editor/stores/buffer.store");
    const { splitActiveEditorGroup } = await import("../utils/pane-command-actions");
    const paneActions = usePaneStore.getState().actions;

    useBufferStore.setState((state) => ({
      ...state,
      buffers: [
        {
          id: "terminal-a",
          type: "terminal",
          path: "terminal://terminal-a",
          name: "Terminal",
          isPinned: false,
          isPreview: false,
          isActive: true,
          sessionId: "terminal-a",
        },
      ],
      activeBufferId: "terminal-a",
    }));
    paneActions.addBufferToPane(ROOT_PANE_ID, "terminal-a");

    expect(splitActiveEditorGroup("horizontal")).toBe(true);

    const groups = getAllPaneGroups(usePaneStore.getState().root);
    expect(groups).toHaveLength(2);
    expect(groups.find((pane) => pane.id === ROOT_PANE_ID)?.bufferIds).toEqual(["terminal-a"]);
    expect(groups.find((pane) => pane.id !== ROOT_PANE_ID)?.bufferIds).toEqual([]);
  });

  it("closes only when another editor group can receive the buffers", async () => {
    const { closeActiveEditorGroup } = await import("../utils/pane-command-actions");
    const paneActions = usePaneStore.getState().actions;

    paneActions.addBufferToPane(ROOT_PANE_ID, "buffer-a");
    expect(closeActiveEditorGroup()).toBe(false);

    const splitPaneId = paneActions.splitPane(ROOT_PANE_ID, "horizontal");
    expect(splitPaneId).not.toBeNull();
    if (!splitPaneId) return;

    paneActions.setActivePane(splitPaneId);
    expect(closeActiveEditorGroup()).toBe(true);
    expect(getAllPaneGroups(usePaneStore.getState().root)).toHaveLength(1);
    expect(paneActions.getPaneById(ROOT_PANE_ID)?.bufferIds).toEqual(["buffer-a"]);
  });

  it("closes other editor groups into the active editor group", async () => {
    const { closeOtherEditorGroups } = await import("../utils/pane-command-actions");
    const paneActions = usePaneStore.getState().actions;

    paneActions.addBufferToPane(ROOT_PANE_ID, "buffer-a");
    const rightPaneId = paneActions.splitPane(ROOT_PANE_ID, "horizontal");
    expect(rightPaneId).not.toBeNull();
    if (!rightPaneId) return;

    paneActions.addBufferToPane(rightPaneId, "buffer-b");
    paneActions.setActivePane(ROOT_PANE_ID);

    expect(closeOtherEditorGroups()).toBe(true);
    expect(getAllPaneGroups(usePaneStore.getState().root)).toHaveLength(1);
    expect(paneActions.getPaneById(ROOT_PANE_ID)?.bufferIds).toEqual(["buffer-a", "buffer-b"]);
    expect(usePaneStore.getState().activePaneId).toBe(ROOT_PANE_ID);
  });

  it("resets nested editor group sizes", async () => {
    const { resetEditorGroupSizes } = await import("../utils/pane-command-actions");
    const paneActions = usePaneStore.getState().actions;

    const rightPaneId = paneActions.splitPane(ROOT_PANE_ID, "horizontal");
    expect(rightPaneId).not.toBeNull();
    if (!rightPaneId) return;

    const bottomRightPaneId = paneActions.splitPane(rightPaneId, "vertical");
    expect(bottomRightPaneId).not.toBeNull();
    if (!bottomRightPaneId) return;

    const root = usePaneStore.getState().root;
    expect(root.type).toBe("split");
    if (root.type !== "split") return;
    expect(root.children[1].type).toBe("split");
    if (root.children[1].type !== "split") return;

    paneActions.updatePaneSizes(root.id, [75, 25]);
    paneActions.updatePaneSizes(root.children[1].id, [30, 70]);

    expect(resetEditorGroupSizes()).toBe(true);

    const nextRoot = usePaneStore.getState().root;
    expect(nextRoot.type).toBe("split");
    if (nextRoot.type !== "split") return;
    expect(nextRoot.sizes).toEqual([50, 50]);
    expect(nextRoot.children[1].type).toBe("split");
    if (nextRoot.children[1].type !== "split") return;
    expect(nextRoot.children[1].sizes).toEqual([50, 50]);
  });

  it("moves the active editor into the next and previous editor group", async () => {
    const { moveActiveEditorToAdjacentGroup } = await import("../utils/pane-command-actions");
    const paneActions = usePaneStore.getState().actions;

    paneActions.addBufferToPane(ROOT_PANE_ID, "buffer-a");
    paneActions.addBufferToPane(ROOT_PANE_ID, "buffer-b");
    const rightPaneId = paneActions.splitPane(ROOT_PANE_ID, "horizontal");
    expect(rightPaneId).not.toBeNull();
    if (!rightPaneId) return;

    paneActions.activatePaneBuffer(ROOT_PANE_ID, "buffer-a");
    expect(moveActiveEditorToAdjacentGroup("next")).toBe(true);

    expect(paneActions.getPaneById(ROOT_PANE_ID)?.bufferIds).toEqual(["buffer-b"]);
    expect(paneActions.getPaneById(rightPaneId)?.bufferIds).toEqual(["buffer-a"]);
    expect(usePaneStore.getState().activePaneId).toBe(rightPaneId);

    expect(moveActiveEditorToAdjacentGroup("previous")).toBe(true);

    expect(paneActions.getPaneById(ROOT_PANE_ID)?.bufferIds).toEqual(["buffer-b", "buffer-a"]);
    expect(getAllPaneGroups(usePaneStore.getState().root)).toHaveLength(1);
    expect(usePaneStore.getState().activePaneId).toBe(ROOT_PANE_ID);
  });

  it("does not run editor group commands against bottom pane splits", async () => {
    const {
      closeActiveEditorGroup,
      moveActiveEditorToAdjacentGroup,
      splitActiveEditorGroup,
      toggleActiveEditorGroupLock,
    } = await import("../utils/pane-command-actions");
    const paneActions = usePaneStore.getState().actions;

    paneActions.addBufferToPane(BOTTOM_PANE_ID, "terminal-a");
    const splitPaneId = paneActions.splitPane(BOTTOM_PANE_ID, "horizontal");
    expect(splitPaneId).not.toBeNull();
    if (!splitPaneId) return;

    paneActions.addBufferToPane(splitPaneId, "terminal-b");
    paneActions.setActivePane(splitPaneId);

    expect(splitActiveEditorGroup("horizontal")).toBe(false);
    expect(closeActiveEditorGroup()).toBe(false);
    expect(moveActiveEditorToAdjacentGroup("previous")).toBe(false);
    expect(toggleActiveEditorGroupLock()).toBe(false);
    expect(getAllPaneGroups(usePaneStore.getState().bottomRoot)).toHaveLength(2);
    expect(paneActions.getPaneById(splitPaneId)?.locked).toBeFalsy();
  });
});
