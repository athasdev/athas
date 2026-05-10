import { describe, expect, it } from "vite-plus/test";
import { ROOT_PANE_ID } from "../constants/pane";
import type { PaneGroup, PaneNode } from "../types/pane";
import { createPaneGroup, createPaneSplit } from "../utils/pane-tree";
import { getPaneScopeForPaneId, resolveWritablePaneForBuffer } from "../utils/pane-routing";

const createRootPane = (overrides: Partial<PaneGroup> = {}): PaneGroup => ({
  id: ROOT_PANE_ID,
  type: "group",
  bufferIds: [],
  activeBufferId: null,
  ...overrides,
});

const bottomRoot: PaneGroup = {
  id: "bottom-pane",
  type: "group",
  bufferIds: [],
  activeBufferId: null,
};

describe("pane routing", () => {
  it("keeps existing buffers in a locked active pane", () => {
    const activePane = createRootPane({ bufferIds: ["buffer-a"], locked: true });

    expect(
      resolveWritablePaneForBuffer({
        activePane,
        bottomRoot,
        bufferId: "buffer-a",
        mostRecentActivePaneIds: [ROOT_PANE_ID],
        root: activePane,
      }),
    ).toBe(activePane);
  });

  it("routes new buffers to the most recent unlocked pane in the same tree", () => {
    const activePane = createRootPane({ bufferIds: ["buffer-a"], locked: true });
    const firstFallback = createPaneGroup(["buffer-b"], "buffer-b");
    const mostRecentFallback = createPaneGroup(["buffer-c"], "buffer-c");
    const root: PaneNode = createPaneSplit(
      "horizontal",
      activePane,
      createPaneSplit("vertical", firstFallback, mostRecentFallback),
    );

    expect(
      resolveWritablePaneForBuffer({
        activePane,
        bottomRoot,
        bufferId: "buffer-d",
        mostRecentActivePaneIds: [activePane.id, mostRecentFallback.id, firstFallback.id],
        root,
      }),
    ).toBe(mostRecentFallback);
  });

  it("returns null when every pane in the active tree is locked", () => {
    const activePane = createRootPane({ bufferIds: ["buffer-a"], locked: true });
    const lockedFallback = createPaneGroup(["buffer-b"], "buffer-b");
    lockedFallback.locked = true;
    const root = createPaneSplit("horizontal", activePane, lockedFallback);

    expect(
      resolveWritablePaneForBuffer({
        activePane,
        bottomRoot,
        bufferId: "buffer-c",
        mostRecentActivePaneIds: [lockedFallback.id, activePane.id],
        root,
      }),
    ).toBeNull();
  });

  it("keeps routing scope within the active pane tree", () => {
    const root = createRootPane();
    const bottomActivePane = createPaneGroup(["terminal-a"], "terminal-a");
    const bottomFallbackPane = createPaneGroup(["terminal-b"], "terminal-b");
    const bottomTree = createPaneSplit("horizontal", bottomActivePane, bottomFallbackPane);

    expect(getPaneScopeForPaneId(root, bottomTree, bottomFallbackPane.id)).toEqual([
      bottomActivePane,
      bottomFallbackPane,
    ]);
  });
});
