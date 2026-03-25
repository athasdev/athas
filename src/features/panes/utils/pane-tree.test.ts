import { describe, expect, it } from "vite-plus/test";
import { createPaneGroup, getAdjacentPane, splitPane } from "./pane-tree";
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
