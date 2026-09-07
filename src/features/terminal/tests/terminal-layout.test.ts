import { describe, expect, it } from "vite-plus/test";
import { flattenPaneSplit } from "@/features/panes/utils/pane-tree";
import {
  distributeTerminalLayout,
  findTerminalLayout,
  getAdjacentLayoutTerminalId,
  getLayoutMemberIds,
  getLayoutTerminalIds,
  isTerminalLayoutSplit,
  removeTerminalFromLayouts,
  resizeTerminalLayout,
  splitTerminalLayout,
} from "../utils/terminal-layout";

describe("terminal layouts", () => {
  it("creates a layout when a standalone terminal is split", () => {
    const layouts = splitTerminalLayout([], "a", "b", "right");

    expect(layouts).toHaveLength(1);
    const layout = layouts[0];
    expect(isTerminalLayoutSplit(layout) && layout.direction).toBe("horizontal");
    expect(getLayoutTerminalIds(layout)).toEqual(["a", "b"]);
    expect(findTerminalLayout(layouts, "b")).toBe(layout);
    expect(getLayoutMemberIds(layouts, "c")).toEqual(["c"]);
  });

  it("places the new terminal before the target when asked", () => {
    const layouts = splitTerminalLayout([], "a", "b", "down", "before");
    expect(getLayoutTerminalIds(layouts[0])).toEqual(["b", "a"]);
  });

  it("moves a terminal out of its previous layout when it is dropped elsewhere", () => {
    const first = splitTerminalLayout([], "a", "b", "right");
    const withSecond = splitTerminalLayout(first, "c", "d", "right");
    const moved = splitTerminalLayout(withSecond, "c", "b", "down");

    expect(moved).toHaveLength(1);
    expect(getLayoutTerminalIds(moved[0])).toEqual(["c", "b", "d"]);
    expect(findTerminalLayout(moved, "a")).toBeNull();
  });

  it("nests splits in the opposite direction inside the existing layout", () => {
    const layouts = splitTerminalLayout(
      splitTerminalLayout([], "a", "b", "right"),
      "b",
      "c",
      "down",
    );

    expect(layouts).toHaveLength(1);
    expect(getLayoutTerminalIds(layouts[0])).toEqual(["a", "b", "c"]);
    const root = layouts[0];
    if (!isTerminalLayoutSplit(root)) throw new Error("expected a split");
    const second = root.children[1];
    expect(second.type === "split" && second.direction).toBe("vertical");
  });

  it("collapses a layout back to a standalone terminal when a member closes", () => {
    const layouts = splitTerminalLayout(
      splitTerminalLayout([], "a", "b", "right"),
      "b",
      "c",
      "down",
    );

    const afterClosingC = removeTerminalFromLayouts(layouts, "c");
    expect(getLayoutTerminalIds(afterClosingC[0])).toEqual(["a", "b"]);

    const afterClosingB = removeTerminalFromLayouts(afterClosingC, "b");
    expect(afterClosingB).toEqual([]);
    expect(removeTerminalFromLayouts(afterClosingB, "zzz")).toBe(afterClosingB);
  });

  it("resizes and redistributes flattened splits", () => {
    const layouts = splitTerminalLayout(
      splitTerminalLayout([], "a", "b", "right"),
      "b",
      "c",
      "right",
    );
    const root = layouts[0];
    if (!isTerminalLayoutSplit(root)) throw new Error("expected a split");

    const resized = resizeTerminalLayout(layouts, root.id, 0, [70, 30]);
    const resizedRoot = resized[0];
    if (!isTerminalLayoutSplit(resizedRoot)) throw new Error("expected a split");
    const sizes = flattenPaneSplit(resizedRoot).map((entry) => entry.size);
    expect(sizes[0]).toBeCloseTo(52.5, 1);
    expect(sizes[1]).toBeCloseTo(22.5, 1);
    expect(sizes[2]).toBeCloseTo(25, 1);

    const distributed = distributeTerminalLayout(resized, root.id);
    const distributedRoot = distributed[0];
    if (!isTerminalLayoutSplit(distributedRoot)) throw new Error("expected a split");
    for (const entry of flattenPaneSplit(distributedRoot)) {
      expect(Math.round(entry.size * 10) / 10).toBeCloseTo(33.3, 0);
    }
    expect(resizeTerminalLayout(layouts, "missing", 0, [50, 50])).toBe(layouts);
  });

  it("cycles focus between the terminals of a layout", () => {
    const layouts = splitTerminalLayout(
      splitTerminalLayout([], "a", "b", "right"),
      "b",
      "c",
      "down",
    );

    expect(getAdjacentLayoutTerminalId(layouts, "a", 1)).toBe("b");
    expect(getAdjacentLayoutTerminalId(layouts, "c", 1)).toBe("a");
    expect(getAdjacentLayoutTerminalId(layouts, "a", -1)).toBe("c");
    expect(getAdjacentLayoutTerminalId(layouts, "solo", 1)).toBeNull();
  });
});
