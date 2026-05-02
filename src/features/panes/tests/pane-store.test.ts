import { afterEach, describe, expect, it } from "vite-plus/test";
import { BOTTOM_PANE_ID, ROOT_PANE_ID } from "../constants/pane";
import { usePaneStore } from "../stores/pane-store";
import { getAllPaneGroups } from "../utils/pane-tree";

describe("pane-store bottom pane integration", () => {
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
});
