import { afterEach, describe, expect, it } from "vite-plus/test";
import { BOTTOM_PANE_ID, ROOT_PANE_ID } from "../constants/pane";
import { usePaneStore } from "../stores/pane.store";
import { getAllPaneGroups } from "../utils/pane-tree";

describe("pane.store bottom pane integration", () => {
  afterEach(() => {
    usePaneStore.getState().actions.reset();
  });

  it("moves buffers between the root pane and the bottom pane", () => {
    const { actions } = usePaneStore.getState();

    actions.addBufferToPane(ROOT_PANE_ID, "buffer-a");
    actions.moveBufferToPane("buffer-a", ROOT_PANE_ID, BOTTOM_PANE_ID);

    let state = usePaneStore.getState();
    expect(state.root.type).toBe("group");
    if (state.root.type !== "group") return;
    expect(state.root.bufferIds).toEqual([]);
    expect(state.bottomRoot.type).toBe("group");
    if (state.bottomRoot.type !== "group") return;
    expect(state.bottomRoot.bufferIds).toEqual(["buffer-a"]);
    expect(state.bottomRoot.activeBufferId).toBe("buffer-a");

    actions.moveBufferToPane("buffer-a", BOTTOM_PANE_ID, ROOT_PANE_ID);

    state = usePaneStore.getState();
    expect(state.root.type).toBe("group");
    if (state.root.type !== "group") return;
    expect(state.root.bufferIds).toEqual(["buffer-a"]);
    expect(state.root.activeBufferId).toBe("buffer-a");
    expect(getAllPaneGroups(state.bottomRoot).flatMap((pane) => pane.bufferIds)).toEqual([]);
  });

  it("can split the bottom root like any other pane tree", () => {
    const { actions } = usePaneStore.getState();

    actions.addBufferToPane(BOTTOM_PANE_ID, "buffer-a");
    const newPaneId = actions.splitPane(BOTTOM_PANE_ID, "horizontal");

    expect(newPaneId).not.toBeNull();

    const state = usePaneStore.getState();
    const bottomGroups = getAllPaneGroups(state.bottomRoot);
    expect(bottomGroups).toHaveLength(2);
    expect(bottomGroups[0]?.bufferIds).toEqual(["buffer-a"]);
  });

  it("preserves an empty source pane when moving the only buffer into a new split", () => {
    const { actions } = usePaneStore.getState();

    actions.addBufferToPane(ROOT_PANE_ID, "buffer-a");
    const newPaneId = actions.splitPane(ROOT_PANE_ID, "horizontal");
    expect(newPaneId).not.toBeNull();
    if (!newPaneId) return;

    actions.moveBufferToPane("buffer-a", ROOT_PANE_ID, newPaneId, true);

    const state = usePaneStore.getState();
    const groups = getAllPaneGroups(state.root);
    expect(groups).toHaveLength(2);
    expect(groups.find((pane) => pane.id === ROOT_PANE_ID)?.bufferIds).toEqual([]);
    expect(groups.find((pane) => pane.id === newPaneId)?.bufferIds).toEqual(["buffer-a"]);
  });

  it("falls back to the most recently active remaining pane when closing the active pane", () => {
    const { actions } = usePaneStore.getState();

    actions.addBufferToPane(ROOT_PANE_ID, "buffer-a");
    const rightPaneId = actions.splitPane(ROOT_PANE_ID, "horizontal");
    expect(rightPaneId).not.toBeNull();
    if (!rightPaneId) return;

    const bottomPaneId = actions.splitPane(rightPaneId, "vertical");
    expect(bottomPaneId).not.toBeNull();
    if (!bottomPaneId) return;

    actions.setActivePane(ROOT_PANE_ID);
    actions.setActivePane(rightPaneId);
    actions.setActivePane(bottomPaneId);
    actions.addBufferToPane(bottomPaneId, "buffer-b");
    actions.closePane(bottomPaneId);

    expect(usePaneStore.getState().activePaneId).toBe(rightPaneId);
    expect(actions.getPaneById(rightPaneId)?.bufferIds).toEqual(["buffer-b"]);
    expect(actions.getPaneById(rightPaneId)?.activeBufferId).toBe("buffer-b");
  });

  it("merges buffers into the fallback pane when closing an inactive pane", () => {
    const { actions } = usePaneStore.getState();

    actions.addBufferToPane(ROOT_PANE_ID, "buffer-a");
    const rightPaneId = actions.splitPane(ROOT_PANE_ID, "horizontal");
    expect(rightPaneId).not.toBeNull();
    if (!rightPaneId) return;

    actions.addBufferToPane(rightPaneId, "buffer-b");
    actions.setActivePane(ROOT_PANE_ID);
    actions.closePane(rightPaneId);

    const rootPane = actions.getPaneById(ROOT_PANE_ID);
    expect(usePaneStore.getState().activePaneId).toBe(ROOT_PANE_ID);
    expect(rootPane?.bufferIds).toEqual(["buffer-a", "buffer-b"]);
    expect(rootPane?.activeBufferId).toBe("buffer-a");
  });

  it("activates a buffer and its pane as a single operation", () => {
    const { actions } = usePaneStore.getState();

    actions.addBufferToPane(ROOT_PANE_ID, "buffer-a");
    const rightPaneId = actions.splitPane(ROOT_PANE_ID, "horizontal");
    expect(rightPaneId).not.toBeNull();
    if (!rightPaneId) return;

    actions.addBufferToPane(rightPaneId, "buffer-b");
    actions.setActivePane(ROOT_PANE_ID);
    actions.activatePaneBuffer(rightPaneId, "buffer-b");

    const state = usePaneStore.getState();
    const rightPane = actions.getPaneById(rightPaneId);
    expect(state.activePaneId).toBe(rightPaneId);
    expect(state.mostRecentActivePaneIds[0]).toBe(rightPaneId);
    expect(rightPane?.activeBufferId).toBe("buffer-b");
    expect(rightPane?.mruBufferIds?.[0]).toBe("buffer-b");
  });

  it("routes pane-local buffer cycling through pane activation metadata", () => {
    const { actions } = usePaneStore.getState();

    actions.addBufferToPane(ROOT_PANE_ID, "buffer-a");
    const rightPaneId = actions.splitPane(ROOT_PANE_ID, "horizontal");
    expect(rightPaneId).not.toBeNull();
    if (!rightPaneId) return;

    actions.addBufferToPane(rightPaneId, "buffer-b");
    actions.addBufferToPane(rightPaneId, "buffer-c");
    actions.setActivePane(ROOT_PANE_ID);
    actions.activatePaneBuffer(rightPaneId, "buffer-b");

    actions.switchToNextBufferInPane();

    let state = usePaneStore.getState();
    let rightPane = actions.getPaneById(rightPaneId);
    expect(state.activePaneId).toBe(rightPaneId);
    expect(state.mostRecentActivePaneIds[0]).toBe(rightPaneId);
    expect(rightPane?.activeBufferId).toBe("buffer-c");
    expect(rightPane?.mruBufferIds?.[0]).toBe("buffer-c");

    actions.switchToPreviousBufferInPane();

    state = usePaneStore.getState();
    rightPane = actions.getPaneById(rightPaneId);
    expect(state.activePaneId).toBe(rightPaneId);
    expect(state.mostRecentActivePaneIds[0]).toBe(rightPaneId);
    expect(rightPane?.activeBufferId).toBe("buffer-b");
    expect(rightPane?.mruBufferIds?.[0]).toBe("buffer-b");
  });

  it("tracks preview and pinned metadata on pane groups", () => {
    const { actions } = usePaneStore.getState();

    actions.addBufferToPane(ROOT_PANE_ID, "buffer-a");
    actions.addBufferToPane(ROOT_PANE_ID, "buffer-b");
    actions.setPanePreviewBuffer(ROOT_PANE_ID, "buffer-a");

    let pane = actions.getPaneById(ROOT_PANE_ID);
    expect(pane?.previewBufferId).toBe("buffer-a");

    actions.setPaneBufferPinned(ROOT_PANE_ID, "buffer-a", true);
    pane = actions.getPaneById(ROOT_PANE_ID);
    expect(pane?.previewBufferId).toBeNull();
    expect(pane?.pinnedBufferIds).toEqual(["buffer-a"]);

    actions.setBufferPinnedEverywhere("buffer-a", false);
    pane = actions.getPaneById(ROOT_PANE_ID);
    expect(pane?.pinnedBufferIds).toEqual([]);
  });

  it("clears preview metadata wherever a buffer is promoted", () => {
    const { actions } = usePaneStore.getState();

    actions.addBufferToPane(ROOT_PANE_ID, "buffer-a");
    const splitPaneId = actions.splitPane(ROOT_PANE_ID, "horizontal");
    expect(splitPaneId).not.toBeNull();
    if (!splitPaneId) return;

    actions.addBufferToPane(splitPaneId, "buffer-a");
    actions.setPanePreviewBuffer(ROOT_PANE_ID, "buffer-a");
    actions.setPanePreviewBuffer(splitPaneId, "buffer-a");

    actions.clearPreviewBufferEverywhere("buffer-a");

    expect(actions.getPaneById(ROOT_PANE_ID)?.previewBufferId).toBeNull();
    expect(actions.getPaneById(splitPaneId)?.previewBufferId).toBeNull();
  });

  it("normalizes restored layouts and preserves active pane history", () => {
    const { actions } = usePaneStore.getState();

    actions.restoreLayout({
      root: {
        id: ROOT_PANE_ID,
        type: "group",
        bufferIds: ["buffer-a", "buffer-a"],
        activeBufferId: "missing-buffer",
      },
      bottomRoot: {
        id: BOTTOM_PANE_ID,
        type: "group",
        bufferIds: [],
        activeBufferId: null,
      },
      activePaneId: ROOT_PANE_ID,
      mostRecentActivePaneIds: ["missing-pane", ROOT_PANE_ID],
      fullscreenPaneId: "missing-pane",
    });

    const state = usePaneStore.getState();
    expect(state.activePaneId).toBe(ROOT_PANE_ID);
    expect(state.fullscreenPaneId).toBeNull();
    expect(state.mostRecentActivePaneIds[0]).toBe(ROOT_PANE_ID);
    expect(state.root.type).toBe("group");
    if (state.root.type !== "group") return;
    expect(state.root.bufferIds).toEqual(["buffer-a"]);
    expect(state.root.activeBufferId).toBe("buffer-a");
  });
});
