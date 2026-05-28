import { describe, expect, it } from "vite-plus/test";
import {
  distributeFlattenedPaneSplit,
  flattenPaneSplit,
  getAdjacentPane,
  normalizePaneTree,
  resizeFlattenedPaneSplit,
  setActivePaneBuffer,
  splitPane,
} from "../utils/pane-tree";
import type { PaneGroup, PaneNode } from "../types/pane";

function createNamedPane(id: string): PaneGroup {
  return {
    id,
    type: "group",
    bufferIds: [],
    activeBufferId: null,
  };
}

describe("splitPane", () => {
  it("places the new pane after the current pane by default", () => {
    const root = createNamedPane("root");
    const result = splitPane(root, "root", "horizontal");

    expect(result.type).toBe("split");
    if (result.type !== "split") return;

    expect(result.children[0].id).toBe("root");
    expect(result.children[1].id).not.toBe("root");
  });

  it("places the new pane before the current pane when requested", () => {
    const root = createNamedPane("root");
    const result = splitPane(root, "root", "horizontal", undefined, "before");

    expect(result.type).toBe("split");
    if (result.type !== "split") return;

    expect(result.children[0].id).not.toBe("root");
    expect(result.children[1].id).toBe("root");
  });
});

describe("normalizePaneTree", () => {
  it("repairs duplicate buffers, invalid active buffers, and unsafe split sizes", () => {
    const root: PaneNode = {
      id: "split",
      type: "split",
      direction: "horizontal",
      sizes: [0, 0],
      children: [
        {
          id: "left",
          type: "group",
          bufferIds: ["a", "a", "b"],
          activeBufferId: "missing",
          mruBufferIds: ["b", "missing", "a"],
          pinnedBufferIds: ["a", "missing"],
          previewBufferId: "missing",
        },
        createNamedPane("right"),
      ],
    };

    const normalized = normalizePaneTree(root);

    expect(normalized.type).toBe("split");
    if (normalized.type !== "split") return;
    expect(normalized.sizes[0] + normalized.sizes[1]).toBe(100);

    const left = normalized.children[0];
    expect(left.type).toBe("group");
    if (left.type !== "group") return;
    expect(left.bufferIds).toEqual(["a", "b"]);
    expect(left.activeBufferId).toBe("a");
    expect(left.mruBufferIds).toEqual(["a", "b"]);
    expect(left.pinnedBufferIds).toEqual(["a"]);
    expect(left.previewBufferId).toBeNull();
  });

  it("tracks active buffer MRU inside a pane group", () => {
    const root = createNamedPane("root");
    const withBuffers = {
      ...root,
      bufferIds: ["a", "b", "c"],
      activeBufferId: "a",
      mruBufferIds: ["a", "b", "c"],
    };

    const result = setActivePaneBuffer(withBuffers, "root", "c");

    expect(result.type).toBe("group");
    if (result.type !== "group") return;
    expect(result.activeBufferId).toBe("c");
    expect(result.mruBufferIds).toEqual(["c", "a", "b"]);
  });
});

describe("flattened pane split layout", () => {
  it("flattens same-direction nested splits into one resize row", () => {
    const left = createNamedPane("left");
    const middle = createNamedPane("middle");
    const right = createNamedPane("right");
    const row: PaneNode = {
      id: "row",
      type: "split",
      direction: "horizontal",
      sizes: [50, 50],
      children: [
        left,
        {
          id: "nested-row",
          type: "split",
          direction: "horizontal",
          sizes: [50, 50],
          children: [middle, right],
        },
      ],
    };

    expect(row.type).toBe("split");
    if (row.type !== "split") return;
    const entries = flattenPaneSplit(row);
    expect(entries.map((entry) => entry.node.id)).toEqual(["left", "middle", "right"]);
    expect(entries.map((entry) => entry.size)).toEqual([50, 25, 25]);
  });

  it("resizes adjacent flattened entries and writes nested split sizes once", () => {
    const root: PaneNode = {
      id: "row",
      type: "split",
      direction: "horizontal",
      sizes: [50, 50],
      children: [
        createNamedPane("left"),
        {
          id: "nested-row",
          type: "split",
          direction: "horizontal",
          sizes: [50, 50],
          children: [createNamedPane("middle"), createNamedPane("right")],
        },
      ],
    };

    const resized = resizeFlattenedPaneSplit(root, "row", 0, [25, 50]);

    expect(resized.type).toBe("split");
    if (resized.type !== "split") return;
    expect(resized.sizes[0]).toBeCloseTo(25);
    expect(resized.sizes[1]).toBeCloseTo(75);
    const nested = resized.children[1];
    expect(nested.type).toBe("split");
    if (nested.type !== "split") return;
    expect(nested.sizes[0]).toBeCloseTo(66.667, 2);
    expect(nested.sizes[1]).toBeCloseTo(33.333, 2);
  });

  it("distributes flattened entries evenly across nested same-direction splits", () => {
    const root: PaneNode = {
      id: "row",
      type: "split",
      direction: "horizontal",
      sizes: [80, 20],
      children: [
        createNamedPane("left"),
        {
          id: "nested-row",
          type: "split",
          direction: "horizontal",
          sizes: [75, 25],
          children: [createNamedPane("middle"), createNamedPane("right")],
        },
      ],
    };

    const distributed = distributeFlattenedPaneSplit(root, "row");

    expect(distributed.type).toBe("split");
    if (distributed.type !== "split") return;
    expect(distributed.sizes[0]).toBeCloseTo(33.333, 2);
    expect(distributed.sizes[1]).toBeCloseTo(66.667, 2);
    const nested = distributed.children[1];
    expect(nested.type).toBe("split");
    if (nested.type !== "split") return;
    expect(nested.sizes).toEqual([50, 50]);
  });
});

describe("getAdjacentPane", () => {
  it("finds panes by geometric direction instead of tree order", () => {
    const left = createNamedPane("left");
    const topRight = createNamedPane("top-right");
    const bottomRight = createNamedPane("bottom-right");

    const rightColumn: PaneNode = {
      id: "right-column",
      type: "split",
      direction: "vertical",
      children: [topRight, bottomRight],
      sizes: [50, 50],
    };

    const root: PaneNode = {
      id: "root-split",
      type: "split",
      direction: "horizontal",
      children: [left, rightColumn],
      sizes: [50, 50],
    };

    expect(getAdjacentPane(root, "top-right", "left")?.id).toBe("left");
    expect(getAdjacentPane(root, "bottom-right", "left")?.id).toBe("left");
    expect(getAdjacentPane(root, "left", "right")?.id).toBe("top-right");
    expect(getAdjacentPane(root, "top-right", "down")?.id).toBe("bottom-right");
    expect(getAdjacentPane(root, "bottom-right", "up")?.id).toBe("top-right");
  });
});
