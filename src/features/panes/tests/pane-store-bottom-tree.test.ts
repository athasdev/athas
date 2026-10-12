import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { BOTTOM_PANE_ID, ROOT_PANE_ID } from "../constants/pane";
import { getAllPaneGroups } from "../services/pane-tree";
import { usePaneStore } from "../stores/pane.store";
import type { PaneGroup, PaneSplit } from "../types/pane.types";

const state = () => usePaneStore.getState();
const actions = () => state().actions;
const bottomGroups = () => getAllPaneGroups(state().bottomRoot);
const rootGroups = () => getAllPaneGroups(state().root);
const pane = (id: string) => actions().getPaneById(id) as PaneGroup;

function splitBottom(): string {
  actions().addBufferToPane(BOTTOM_PANE_ID, "term-1");
  const newPaneId = actions().splitPane(BOTTOM_PANE_ID, "horizontal", "term-2");
  if (!newPaneId) throw new Error("split failed");
  return newPaneId;
}

beforeEach(() => {
  actions().reset();
});

afterEach(() => {
  actions().reset();
});

describe("bottom pane tree", () => {
  it("adds, reorders, pins, previews and locks tabs in the bottom pane", () => {
    actions().addBufferToPane(BOTTOM_PANE_ID, "a");
    actions().addBufferToPane(BOTTOM_PANE_ID, "b");
    actions().addBufferToPane(BOTTOM_PANE_ID, "c", false);

    actions().reorderPaneBuffers(BOTTOM_PANE_ID, 2, 0);
    actions().setPaneBufferPinned(BOTTOM_PANE_ID, "b", true);
    actions().setPanePreviewBuffer(BOTTOM_PANE_ID, "a");
    actions().setPaneLocked(BOTTOM_PANE_ID, true);

    expect(pane(BOTTOM_PANE_ID)).toMatchObject({
      bufferIds: ["c", "a", "b"],
      activeBufferId: "b",
      pinnedBufferIds: ["b"],
      previewBufferId: "a",
      locked: true,
    });
    expect(rootGroups().flatMap((group) => group.bufferIds)).toEqual([]);
  });

  it("splits the bottom pane, resizes and evens out the split", () => {
    const newPaneId = splitBottom();
    const split = state().bottomRoot as PaneSplit;
    expect(split.type).toBe("split");
    expect(bottomGroups().map((group) => group.bufferIds)).toEqual([["term-1"], ["term-2"]]);
    expect(state().activePaneId).toBe(newPaneId);

    actions().updatePaneSizes(split.id, [30, 70]);
    expect((state().bottomRoot as PaneSplit).sizes).toEqual([30, 70]);

    actions().resizePaneSplit(split.id, 0, [60, 40]);
    expect((state().bottomRoot as PaneSplit).sizes).toEqual([60, 40]);

    actions().distributePaneSplit(split.id);
    expect((state().bottomRoot as PaneSplit).sizes).toEqual([50, 50]);
  });

  it("moves focus between split bottom panes", () => {
    const right = splitBottom();
    const left = bottomGroups()[0].id;

    actions().navigateToPane("left");
    expect(state().activePaneId).toBe(left);
    actions().navigateToPane("left");
    expect(state().activePaneId).toBe(left);
    actions().navigateToPane("right");
    expect(state().activePaneId).toBe(right);
  });

  it("collapses an emptied bottom split pane and refocuses a remaining one", () => {
    const right = splitBottom();

    actions().removeBufferFromPane(right, "term-2");

    expect(state().bottomRoot.type).toBe("group");
    expect(bottomGroups().map((group) => group.bufferIds)).toEqual([["term-1"]]);
    expect(state().activePaneId).not.toBe(right);
  });

  it("keeps an emptied bottom pane when asked to", () => {
    const right = splitBottom();

    actions().removeBufferFromPane(right, "term-2", true);

    expect(pane(right)).toMatchObject({ bufferIds: [] });
  });

  it("closes a bottom split pane by merging its tabs into the remaining pane", () => {
    const right = splitBottom();
    actions().addBufferToPane(right, "term-3");
    actions().setPaneBufferPinned(right, "term-3", true);
    actions().togglePaneFullscreen(right);
    expect(state().fullscreenPaneId).toBe(right);

    actions().closePane(right);

    const [remaining] = bottomGroups();
    expect(bottomGroups()).toHaveLength(1);
    expect(remaining.bufferIds).toEqual(["term-1", "term-2", "term-3"]);
    expect(remaining.pinnedBufferIds).toEqual(["term-3"]);
    expect(remaining.activeBufferId).toBe("term-3");
    expect(state().activePaneId).toBe(remaining.id);
    expect(state().fullscreenPaneId).toBeNull();
  });

  it("resets the bottom pane when its only group closes", () => {
    actions().addBufferToPane(BOTTOM_PANE_ID, "term-1");
    actions().setActivePane(BOTTOM_PANE_ID);

    actions().closePane(BOTTOM_PANE_ID);

    expect(state().bottomRoot).toMatchObject({ id: BOTTOM_PANE_ID, bufferIds: [] });
    expect(actions().getPaneById(state().activePaneId)).not.toBeNull();
  });

  it("resets the editor area when the root group closes", () => {
    actions().addBufferToPane(ROOT_PANE_ID, "file-a");

    actions().closePane(ROOT_PANE_ID);

    expect(state().root).toMatchObject({ id: ROOT_PANE_ID, bufferIds: [] });
    expect(state().activePaneId).toBe(ROOT_PANE_ID);
  });

  it("moves a pinned tab between bottom panes and from the bottom to the editor", () => {
    const right = splitBottom();
    const left = bottomGroups()[0].id;
    actions().setPaneBufferPinned(left, "term-1", true);

    actions().moveBufferToPane("term-1", left, right, true);
    expect(pane(right)).toMatchObject({
      bufferIds: ["term-2", "term-1"],
      pinnedBufferIds: ["term-1"],
    });
    expect(pane(left).bufferIds).toEqual([]);

    actions().moveBufferToPane("term-2", right, ROOT_PANE_ID);
    expect(pane(ROOT_PANE_ID)).toMatchObject({ bufferIds: ["term-2"], activeBufferId: "term-2" });
    expect(state().activePaneId).toBe(ROOT_PANE_ID);
  });

  it("finds panes by buffer across both trees and toggles fullscreen only for known panes", () => {
    actions().addBufferToPane(ROOT_PANE_ID, "file-a");
    actions().addBufferToPane(BOTTOM_PANE_ID, "term-1");

    expect(actions().getPaneByBufferId("term-1")?.id).toBe(BOTTOM_PANE_ID);
    expect(
      actions()
        .getAllPaneGroups()
        .map((group) => group.id),
    ).toEqual([ROOT_PANE_ID, BOTTOM_PANE_ID]);

    actions().togglePaneFullscreen("missing");
    expect(state().fullscreenPaneId).toBeNull();
    actions().togglePaneFullscreen(BOTTOM_PANE_ID);
    expect(state().fullscreenPaneId).toBe(BOTTOM_PANE_ID);
    actions().togglePaneFullscreen(BOTTOM_PANE_ID);
    expect(state().fullscreenPaneId).toBeNull();
    actions().togglePaneFullscreen(ROOT_PANE_ID);
    actions().exitPaneFullscreen();
    expect(state().fullscreenPaneId).toBeNull();
  });

  it("reveals a buffer in the pane that already shows it", () => {
    actions().addBufferToPane(BOTTOM_PANE_ID, "term-1");
    actions().addBufferToPane(ROOT_PANE_ID, "file-a");
    actions().setActivePane(ROOT_PANE_ID);

    expect(actions().placeBuffer("term-1", { reveal: true })).toBe(BOTTOM_PANE_ID);
    expect(state().activePaneId).toBe(BOTTOM_PANE_ID);
    expect(pane(ROOT_PANE_ID).bufferIds).toEqual(["file-a"]);
  });

  it("shows a buffer as a preview, then makes it definite", () => {
    actions().placeBuffer("file-a", { paneId: ROOT_PANE_ID, preview: true });
    expect(pane(ROOT_PANE_ID).previewBufferId).toBe("file-a");

    actions().placeBuffer("file-a", { paneId: ROOT_PANE_ID, preview: false });
    expect(pane(ROOT_PANE_ID).previewBufferId ?? null).toBeNull();
  });
});
