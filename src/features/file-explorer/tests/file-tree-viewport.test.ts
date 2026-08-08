import { describe, expect, test } from "vite-plus/test";
import {
  getFileTreeScrollTop,
  getFileTreeTotalHeight,
  getFileTreeVirtualRange,
} from "../lib/file-tree-viewport";

describe("file tree viewport geometry", () => {
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
});
