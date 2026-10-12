import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { BOTTOM_PANE_ID, ROOT_PANE_ID } from "../constants/pane";
import { usePaneStore } from "../stores/pane.store";
import type { PaneGroup } from "../types/pane.types";

const state = () => usePaneStore.getState();
const actions = () => state().actions;
const pane = (id: string) => actions().getPaneById(id) as PaneGroup;

beforeEach(() => {
  actions().reset();
});

describe("hidden bottom panes", () => {
  afterEach(() => {
    actions().setBottomBuffersVisible(true);
    actions().reset();
  });

  it("opens new buffers in the editor while the focused bottom pane is hidden", () => {
    actions().addBufferToPane(ROOT_PANE_ID, "file-a");
    actions().addBufferToPane(BOTTOM_PANE_ID, "file-b");
    actions().setActivePane(BOTTOM_PANE_ID);
    // A restored session can leave the focus on a bottom pane that is not on screen.
    usePaneStore.setState({ bottomBuffersVisible: false });
    expect(actions().placeBuffer("file-c")).toBe(ROOT_PANE_ID);
    expect(pane(ROOT_PANE_ID).bufferIds).toEqual(["file-a", "file-c"]);
    expect(pane(BOTTOM_PANE_ID).bufferIds).toEqual(["file-b"]);
    expect(state().activePaneId).toBe(ROOT_PANE_ID);
  });

  it("reveals a buffer left in a hidden bottom pane in the editor instead", () => {
    actions().addBufferToPane(ROOT_PANE_ID, "file-a");
    actions().addBufferToPane(BOTTOM_PANE_ID, "file-b");
    actions().setBottomBuffersVisible(false);

    expect(actions().placeBuffer("file-b", { reveal: true })).toBe(ROOT_PANE_ID);
    expect(pane(ROOT_PANE_ID).activeBufferId).toBe("file-b");
    expect(state().activePaneId).toBe(ROOT_PANE_ID);
  });

  it("moves focus back to the editor when the bottom panes are hidden", () => {
    actions().addBufferToPane(ROOT_PANE_ID, "file-a");
    actions().addBufferToPane(BOTTOM_PANE_ID, "file-b");
    actions().setActivePane(BOTTOM_PANE_ID);

    actions().setBottomBuffersVisible(false);
    expect(state().activePaneId).toBe(ROOT_PANE_ID);
  });

  it("keeps using the focused bottom pane while it is on screen", () => {
    actions().addBufferToPane(BOTTOM_PANE_ID, "file-b");
    actions().setBottomBuffersVisible(true);
    actions().setActivePane(BOTTOM_PANE_ID);

    expect(actions().placeBuffer("file-c")).toBe(BOTTOM_PANE_ID);
    expect(actions().placeBuffer("file-b", { reveal: true })).toBe(BOTTOM_PANE_ID);
  });
});
