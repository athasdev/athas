import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { ROOT_PANE_ID } from "../constants/pane";
import { usePaneStore } from "../stores/pane-store";
import { getAllPaneGroups } from "../utils/pane-tree";
import { createPaneBeside } from "../utils/pane-split-actions";

describe("pane split actions", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    usePaneStore.getState().actions.reset();
  });

  it("creates an adjacent pane and activates it", () => {
    const paneId = createPaneBeside(ROOT_PANE_ID, "horizontal");

    expect(paneId).not.toBeNull();
    expect(getAllPaneGroups(usePaneStore.getState().root)).toHaveLength(2);
    expect(usePaneStore.getState().activePaneId).toBe(paneId);
  });

  it("can seed the adjacent pane with a shared buffer", () => {
    const paneActions = usePaneStore.getState().actions;

    paneActions.addBufferToPane(ROOT_PANE_ID, "buffer-a");

    const paneId = createPaneBeside(ROOT_PANE_ID, "horizontal", "after", "buffer-a");

    expect(paneId).not.toBeNull();
    if (!paneId) return;
    expect(paneActions.getPaneById(paneId)?.bufferIds).toEqual(["buffer-a"]);
  });
});
