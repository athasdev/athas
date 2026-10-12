import { describe, expect, it } from "vite-plus/test";
import {
  addBufferToPane,
  closePane,
  createPaneGroup,
  createPaneSplit,
  findPaneGroup,
  getAllPaneGroups,
  getFirstPaneGroup,
  moveBufferBetweenPanes,
  removeBufferFromPane,
  reorderPaneBuffers,
  setActivePaneBuffer,
  setPaneBufferPinned,
  setPaneBufferPinnedEverywhere,
  setPaneLocked,
  setPanePreviewBuffer,
  splitPane,
} from "../services/pane-tree";
import type { PaneGroup, PaneSplit } from "../types/pane.types";

function threePanes() {
  const left = createPaneGroup(["a", "b", "c"], "b");
  const middle = createPaneGroup(["d"], "d");
  const right = createPaneGroup(["e", "f"], "e");
  const inner = createPaneSplit("vertical", middle, right);
  const root = createPaneSplit("horizontal", left, inner);
  return { root, left, middle, right, inner };
}

const group = (root: Parameters<typeof findPaneGroup>[0], id: string) =>
  findPaneGroup(root, id) as PaneGroup;

describe("pane tree edits", () => {
  it("leaves split nodes untouched by group-only edits", () => {
    const { root, inner } = threePanes();
    const edits = [
      (tree: typeof root) => splitPane(tree, inner.id, "horizontal", "x"),
      (tree: typeof root) => addBufferToPane(tree, inner.id, "x"),
      (tree: typeof root) => removeBufferFromPane(tree, inner.id, "d"),
      (tree: typeof root) => setActivePaneBuffer(tree, inner.id, "d"),
      (tree: typeof root) => setPanePreviewBuffer(tree, inner.id, "d"),
      (tree: typeof root) => setPaneBufferPinned(tree, inner.id, "d", true),
      (tree: typeof root) => setPaneLocked(tree, inner.id, true),
      (tree: typeof root) => reorderPaneBuffers(tree, inner.id, 0, 1),
    ];

    for (const edit of edits) {
      expect(getAllPaneGroups(edit(root))).toEqual(getAllPaneGroups(root));
    }
  });

  it("finds the first group through nested splits", () => {
    const { root, left } = threePanes();
    expect(getFirstPaneGroup(root).id).toBe(left.id);
    expect(getFirstPaneGroup(createPaneSplit("vertical", root, createPaneGroup())).id).toBe(
      left.id,
    );
  });

  it("closes a nested pane and keeps its sibling in place", () => {
    const { root, left, middle, right } = threePanes();

    const closed = closePane(root, right.id) as PaneSplit;

    expect(getAllPaneGroups(closed).map((pane) => pane.id)).toEqual([left.id, middle.id]);
    expect(closePane(root, "unknown")).toBe(root);
    expect(closePane(left, left.id)).toBeNull();
  });

  it("moves a pinned buffer between panes and keeps it pinned", () => {
    const { root, left, right } = threePanes();
    const pinned = setPaneBufferPinned(root, left.id, "c", true);

    const moved = moveBufferBetweenPanes(pinned, "c", left.id, right.id);

    expect(group(moved, left.id).bufferIds).toEqual(["a", "b"]);
    expect(group(moved, right.id)).toMatchObject({
      bufferIds: ["e", "f", "c"],
      activeBufferId: "c",
      pinnedBufferIds: ["c"],
    });
  });

  it("activates only buffers the pane holds and can clear the active buffer", () => {
    const { root, left } = threePanes();

    expect(group(setActivePaneBuffer(root, left.id, "zzz"), left.id).activeBufferId).toBe("b");
    const activated = setActivePaneBuffer(root, left.id, "c");
    expect(group(activated, left.id)).toMatchObject({
      activeBufferId: "c",
      mruBufferIds: ["c", "b", "a"],
    });
  });

  it("previews and pins only buffers the pane holds", () => {
    const { root, left } = threePanes();

    expect(
      group(setPanePreviewBuffer(root, left.id, "zzz"), left.id).previewBufferId ?? null,
    ).toBeNull();
    const previewed = setPanePreviewBuffer(root, left.id, "a");
    expect(group(previewed, left.id).previewBufferId).toBe("a");
    expect(
      group(setPanePreviewBuffer(previewed, left.id, null), left.id).previewBufferId,
    ).toBeNull();

    expect(
      group(setPaneBufferPinned(root, left.id, "zzz", true), left.id).pinnedBufferIds ?? [],
    ).toEqual([]);
    const pinned = setPaneBufferPinned(previewed, left.id, "a", true);
    expect(group(pinned, left.id)).toMatchObject({ pinnedBufferIds: ["a"] });
    expect(
      group(setPaneBufferPinned(pinned, left.id, "a", false), left.id).pinnedBufferIds,
    ).toEqual([]);
  });

  it("pins a buffer in every pane that shows it and drops its preview state", () => {
    const left = createPaneGroup(["shared", "x"], "shared");
    const right = createPaneGroup(["shared"], "shared");
    const root = createPaneSplit(
      "horizontal",
      setPanePreviewBuffer(left, left.id, "shared"),
      right,
    );

    const pinned = setPaneBufferPinnedEverywhere(root, "shared", true);
    expect(
      getAllPaneGroups(pinned).map((pane) => [pane.pinnedBufferIds, pane.previewBufferId ?? null]),
    ).toEqual([
      [["shared"], null],
      [["shared"], null],
    ]);

    expect(setPaneBufferPinnedEverywhere(root, "absent", true)).toBe(root);
    const unpinned = setPaneBufferPinnedEverywhere(pinned, "shared", false);
    expect(getAllPaneGroups(unpinned).map((pane) => pane.pinnedBufferIds)).toEqual([[], []]);
  });

  it("locks a pane and reorders tabs within bounds only", () => {
    const { root, left } = threePanes();

    expect(group(setPaneLocked(root, left.id, true), left.id).locked).toBe(true);
    expect(group(reorderPaneBuffers(root, left.id, 0, 2), left.id).bufferIds).toEqual([
      "b",
      "c",
      "a",
    ]);
    for (const [from, to] of [
      [-1, 0],
      [0, -1],
      [3, 0],
      [0, 3],
      [1, 1],
    ]) {
      expect(group(reorderPaneBuffers(root, left.id, from, to), left.id).bufferIds).toEqual([
        "a",
        "b",
        "c",
      ]);
    }
  });

  it("picks the next tab when the active one is removed", () => {
    const { root, left } = threePanes();
    const removed = removeBufferFromPane(root, left.id, "b");
    expect(group(removed, left.id)).toMatchObject({ bufferIds: ["a", "c"] });
    expect(group(removed, left.id).activeBufferId).not.toBe("b");
  });
});
