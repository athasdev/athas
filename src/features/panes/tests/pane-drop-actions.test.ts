import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { ROOT_PANE_ID } from "../constants/pane";
import { usePaneStore } from "../stores/pane-store";
import { getAllPaneGroups } from "../utils/pane-tree";
import {
  getOrCreatePaneDropTarget,
  moveBufferToPaneDropTarget,
  ensureBufferInPaneDropTarget,
} from "../utils/pane-drop-actions";

describe("pane drop actions", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    usePaneStore.getState().actions.reset();
  });

  it("creates a split drop target from an edge zone", () => {
    const targetPaneId = getOrCreatePaneDropTarget({ paneId: ROOT_PANE_ID, zone: "right" });

    expect(targetPaneId).not.toBeNull();
    expect(targetPaneId).not.toBe(ROOT_PANE_ID);
    expect(getAllPaneGroups(usePaneStore.getState().root)).toHaveLength(2);
  });

  it("moves buffers through a pane drop target", () => {
    const paneActions = usePaneStore.getState().actions;

    paneActions.addBufferToPane(ROOT_PANE_ID, "buffer-a");
    paneActions.addBufferToPane(ROOT_PANE_ID, "buffer-b");

    const targetPaneId = moveBufferToPaneDropTarget("buffer-a", ROOT_PANE_ID, {
      paneId: ROOT_PANE_ID,
      zone: "right",
    });

    expect(targetPaneId).not.toBeNull();
    if (!targetPaneId) return;
    expect(paneActions.getPaneById(ROOT_PANE_ID)?.bufferIds).toEqual(["buffer-b"]);
    expect(paneActions.getPaneById(targetPaneId)?.bufferIds).toEqual(["buffer-a"]);
    expect(usePaneStore.getState().activePaneId).toBe(targetPaneId);
  });

  it("adds buffers without duplicating existing target entries", () => {
    const paneActions = usePaneStore.getState().actions;

    paneActions.addBufferToPane(ROOT_PANE_ID, "buffer-a");

    expect(ensureBufferInPaneDropTarget("buffer-a", { paneId: ROOT_PANE_ID, zone: "center" })).toBe(
      ROOT_PANE_ID,
    );
    expect(paneActions.getPaneById(ROOT_PANE_ID)?.bufferIds).toEqual(["buffer-a"]);
  });
});
