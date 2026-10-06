import { describe, expect, test } from "vite-plus/test";
import {
  getFileTreeFirstVisibleIndex,
  getFileTreeStickyLayout,
  getFileTreeSubtreeEnds,
  getFileTreeScrollTop,
  getFileTreeTotalHeight,
  getFileTreeVirtualRange,
} from "../lib/file-tree-viewport";

describe("file tree viewport geometry", () => {
  test("finds the first row crossing the visible top edge", () => {
    expect(getFileTreeFirstVisibleIndex({ rowCount: 100, rowHeight: 30, scrollTop: 0 })).toBe(0);
    expect(getFileTreeFirstVisibleIndex({ rowCount: 100, rowHeight: 30, scrollTop: 33 })).toBe(0);
    expect(getFileTreeFirstVisibleIndex({ rowCount: 100, rowHeight: 30, scrollTop: 34 })).toBe(1);
    expect(getFileTreeFirstVisibleIndex({ rowCount: 0, rowHeight: 30, scrollTop: 0 })).toBe(-1);
  });

  test("keeps total height independent from the rendered window", () => {
    const totalHeight = getFileTreeTotalHeight(1_000, 30);

    expect(totalHeight).toBe(30_008);
    expect(
      getFileTreeVirtualRange({
        rowCount: 1_000,
        rowHeight: 30,
        scrollTop: 0,
        viewportHeight: 300,
      }),
    ).toEqual({ startIndex: 0, endIndex: 17 });
    expect(
      getFileTreeVirtualRange({
        rowCount: 1_000,
        rowHeight: 30,
        scrollTop: 15_000,
        viewportHeight: 300,
      }),
    ).toEqual({ startIndex: 491, endIndex: 517 });
    expect(getFileTreeTotalHeight(1_000, 30)).toBe(totalHeight);
  });

  test("uses the smallest scroll adjustment needed to reveal a row", () => {
    expect(
      getFileTreeScrollTop({
        currentScrollTop: 300,
        index: 12,
        rowCount: 100,
        rowHeight: 30,
        viewportHeight: 180,
      }),
    ).toBe(300);
    expect(
      getFileTreeScrollTop({
        currentScrollTop: 0,
        index: 8,
        rowCount: 100,
        rowHeight: 30,
        viewportHeight: 180,
      }),
    ).toBe(94);
    expect(
      getFileTreeScrollTop({
        currentScrollTop: 600,
        index: 4,
        rowCount: 100,
        rowHeight: 30,
        viewportHeight: 180,
      }),
    ).toBe(124);
  });

  test("supports deterministic alignment and clamps at both bounds", () => {
    expect(
      getFileTreeScrollTop({
        alignment: "center",
        currentScrollTop: 0,
        index: 50,
        rowCount: 100,
        rowHeight: 30,
        viewportHeight: 180,
      }),
    ).toBe(1_429);
    expect(
      getFileTreeScrollTop({
        alignment: "start",
        currentScrollTop: 500,
        index: 0,
        rowCount: 100,
        rowHeight: 30,
        viewportHeight: 180,
      }),
    ).toBe(0);
    expect(
      getFileTreeScrollTop({
        alignment: "end",
        currentScrollTop: 0,
        index: 99,
        rowCount: 100,
        rowHeight: 30,
        viewportHeight: 180,
      }),
    ).toBe(2_828);
  });

  test("keeps revealed rows below sticky ancestors", () => {
    expect(
      getFileTreeScrollTop({
        currentScrollTop: 600,
        index: 18,
        rowCount: 100,
        rowHeight: 30,
        viewportHeight: 180,
        viewportStartOffset: 90,
      }),
    ).toBe(454);
    expect(
      getFileTreeScrollTop({
        alignment: "start",
        currentScrollTop: 0,
        index: 18,
        rowCount: 100,
        rowHeight: 30,
        viewportHeight: 180,
        viewportStartOffset: 90,
      }),
    ).toBe(450);
  });
});

describe("file tree sticky headers", () => {
  // src/ { a/ { a1, a2 }, b/ { b1 } }, z
  const depths = [0, 1, 2, 2, 1, 2, 0];
  const subtreeEnds = getFileTreeSubtreeEnds(depths);
  const getAncestors = (index: number) => {
    const ancestors: number[] = [];
    let depth = depths[index]!;
    for (let candidate = index - 1; candidate >= 0 && depth > 0; candidate--) {
      if (depths[candidate]! < depth) {
        ancestors.unshift(candidate);
        depth = depths[candidate]!;
      }
    }
    return ancestors;
  };
  const layout = (scrollTop: number) =>
    getFileTreeStickyLayout({
      scrollTop,
      rowCount: depths.length,
      rowHeight: 10,
      viewportHeight: 100,
      padding: 0,
      getAncestors,
      getSubtreeEnd: (index) => subtreeEnds[index]!,
    });

  test("finds where each folder's subtree ends", () => {
    expect([...subtreeEnds]).toEqual([5, 3, 2, 3, 5, 5, 6]);
  });

  test("pins nothing at the top of the tree", () => {
    expect(layout(0)).toEqual({ rows: [], height: 0 });
  });

  test("pins the ancestors of the row under the stack", () => {
    expect(layout(15)).toEqual({
      rows: [
        { index: 0, top: 0 },
        { index: 1, top: 10 },
      ],
      height: 20,
    });
  });

  test("slides a header up under its parent as its folder ends", () => {
    expect(layout(28)).toEqual({
      rows: [
        { index: 0, top: 0 },
        { index: 1, top: 2 },
      ],
      height: 12,
    });
  });

  test("hands over to the next sibling folder", () => {
    expect(layout(48).rows.map((row) => row.index)).toEqual([0, 4]);
  });

  test("pushes the outermost header out as the tree reaches the next root item", () => {
    expect(layout(55)).toEqual({ rows: [{ index: 0, top: -5 }], height: 5 });
    expect(layout(60)).toEqual({ rows: [], height: 0 });
  });
});
