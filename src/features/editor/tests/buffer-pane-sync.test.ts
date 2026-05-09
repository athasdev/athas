import { afterEach, describe, expect, it } from "vite-plus/test";
import { ROOT_PANE_ID } from "@/features/panes/constants/pane";
import { usePaneStore } from "@/features/panes/stores/pane-store";
import { getAllPaneGroups } from "@/features/panes/utils/pane-tree";
import {
  syncAndFocusBufferInPane,
  syncBufferToPane,
  syncPanePreviewForBuffer,
} from "../stores/buffer-pane-sync";

describe("buffer pane sync", () => {
  afterEach(() => {
    usePaneStore.getState().actions.reset();
  });

  it("routes new buffers away from a locked active pane", () => {
    const { actions } = usePaneStore.getState();

    actions.addBufferToPane(ROOT_PANE_ID, "buffer-a");
    const rightPaneId = actions.splitPane(ROOT_PANE_ID, "horizontal");
    expect(rightPaneId).not.toBeNull();
    if (!rightPaneId) return;

    actions.addBufferToPane(rightPaneId, "buffer-b");
    actions.setActivePane(ROOT_PANE_ID);
    actions.setActivePane(rightPaneId);
    actions.setPaneLocked(rightPaneId, true);

    syncBufferToPane("buffer-c");

    expect(actions.getPaneById(rightPaneId)?.bufferIds).toEqual(["buffer-b"]);
    expect(actions.getPaneById(ROOT_PANE_ID)?.bufferIds).toEqual(["buffer-a", "buffer-c"]);
    expect(usePaneStore.getState().activePaneId).toBe(ROOT_PANE_ID);
  });

  it("creates an unlocked split when every existing pane is locked", () => {
    const { actions } = usePaneStore.getState();

    actions.addBufferToPane(ROOT_PANE_ID, "buffer-a");
    actions.setPaneLocked(ROOT_PANE_ID, true);

    syncBufferToPane("buffer-b");

    const groups = getAllPaneGroups(usePaneStore.getState().root);
    expect(groups).toHaveLength(2);
    expect(groups.find((pane) => pane.id === ROOT_PANE_ID)?.bufferIds).toEqual(["buffer-a"]);

    const newPane = groups.find((pane) => pane.id !== ROOT_PANE_ID);
    expect(newPane?.locked).toBeFalsy();
    expect(newPane?.bufferIds).toEqual(["buffer-b"]);
    expect(usePaneStore.getState().activePaneId).toBe(newPane?.id);
  });

  it("syncs preview metadata for buffers in the active pane", () => {
    const { actions } = usePaneStore.getState();

    actions.addBufferToPane(ROOT_PANE_ID, "buffer-a");

    syncPanePreviewForBuffer("buffer-a", true);
    expect(actions.getPaneById(ROOT_PANE_ID)?.previewBufferId).toBe("buffer-a");

    syncPanePreviewForBuffer("buffer-a", false);
    expect(actions.getPaneById(ROOT_PANE_ID)?.previewBufferId).toBeNull();
  });

  it("focuses an existing buffer in its current pane", () => {
    const { actions } = usePaneStore.getState();

    actions.addBufferToPane(ROOT_PANE_ID, "buffer-a");
    actions.addBufferToPane(ROOT_PANE_ID, "buffer-b");

    syncAndFocusBufferInPane("buffer-a");

    expect(actions.getPaneById(ROOT_PANE_ID)?.bufferIds).toEqual(["buffer-a", "buffer-b"]);
    expect(actions.getPaneById(ROOT_PANE_ID)?.activeBufferId).toBe("buffer-a");
    expect(usePaneStore.getState().activePaneId).toBe(ROOT_PANE_ID);
  });
});
