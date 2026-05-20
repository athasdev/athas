import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { ROOT_PANE_ID } from "../constants/pane";
import { usePaneStore } from "../stores/pane-store";
import { ensureBufferInPane } from "../utils/pane-buffer-actions";

describe("pane buffer actions", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    usePaneStore.getState().actions.reset();
  });

  it("adds missing buffers to an existing pane", () => {
    expect(ensureBufferInPane(ROOT_PANE_ID, "buffer-a")).toBe(ROOT_PANE_ID);
    expect(usePaneStore.getState().actions.getPaneById(ROOT_PANE_ID)?.bufferIds).toEqual([
      "buffer-a",
    ]);
    expect(usePaneStore.getState().activePaneId).toBe(ROOT_PANE_ID);
  });

  it("activates existing buffers without duplicating them", () => {
    const paneActions = usePaneStore.getState().actions;

    paneActions.addBufferToPane(ROOT_PANE_ID, "buffer-a");
    paneActions.addBufferToPane(ROOT_PANE_ID, "buffer-b");

    expect(ensureBufferInPane(ROOT_PANE_ID, "buffer-a")).toBe(ROOT_PANE_ID);
    expect(paneActions.getPaneById(ROOT_PANE_ID)?.bufferIds).toEqual(["buffer-a", "buffer-b"]);
    expect(paneActions.getPaneById(ROOT_PANE_ID)?.activeBufferId).toBe("buffer-a");
  });

  it("returns null for missing panes", () => {
    expect(ensureBufferInPane("missing-pane", "buffer-a")).toBeNull();
  });
});
