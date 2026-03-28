import { beforeEach, describe, expect, test } from "vite-plus/test";
import { ROOT_PANE_ID } from "../constants/pane";
import type { PaneGroup } from "../types/pane";
import { usePaneStore } from "./pane-store";

function createRootPane(bufferIds: string[] = [], activeBufferId: string | null = null): PaneGroup {
  return {
    id: ROOT_PANE_ID,
    type: "group",
    bufferIds,
    activeBufferId,
  };
}

describe("pane-store splitPane", () => {
  beforeEach(() => {
    usePaneStore.getState().actions.reset();
  });

  test("creates an empty active pane when no buffer is provided", () => {
    usePaneStore.setState({
      root: createRootPane(["buffer-1"], "buffer-1"),
      activePaneId: ROOT_PANE_ID,
      fullscreenPaneId: null,
    });

    const newPaneId = usePaneStore.getState().actions.splitPane(ROOT_PANE_ID, "horizontal");
    const state = usePaneStore.getState();

    expect(newPaneId).not.toBeNull();
    if (state.root.type !== "split" || !newPaneId) return;

    expect(state.activePaneId).toBe(newPaneId);

    const newPane = state.root.children.find((child) => child.id === newPaneId);
    expect(newPane?.type).toBe("group");
    if (!newPane || newPane.type !== "group") return;

    expect(newPane.bufferIds).toEqual([]);
    expect(newPane.activeBufferId).toBeNull();
  });

  test("seeds the new pane with the requested buffer when one is provided", () => {
    usePaneStore.setState({
      root: createRootPane(["buffer-1"], "buffer-1"),
      activePaneId: ROOT_PANE_ID,
      fullscreenPaneId: null,
    });

    const newPaneId = usePaneStore
      .getState()
      .actions.splitPane(ROOT_PANE_ID, "horizontal", "buffer-1");
    const state = usePaneStore.getState();

    expect(newPaneId).not.toBeNull();
    if (state.root.type !== "split" || !newPaneId) return;

    const newPane = state.root.children.find((child) => child.id === newPaneId);
    expect(newPane?.type).toBe("group");
    if (!newPane || newPane.type !== "group") return;

    expect(newPane.bufferIds).toEqual(["buffer-1"]);
    expect(newPane.activeBufferId).toBe("buffer-1");
  });
});
