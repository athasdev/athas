import { describe, expect, test } from "vite-plus/test";
import { isVirtualRowFullyVisible } from "../hooks/use-file-explorer-visible-rows";

describe("isVirtualRowFullyVisible", () => {
  test("returns true when the virtual row is inside the current viewport", () => {
    expect(
      isVirtualRowFullyVisible({
        index: 2,
        virtualRows: [
          { index: 1, start: 24, end: 48 },
          { index: 2, start: 48, end: 72 },
        ],
        scrollOffset: 24,
        viewportHeight: 96,
      }),
    ).toBe(true);
  });

  test("returns false when an overscanned row is mounted outside the viewport", () => {
    expect(
      isVirtualRowFullyVisible({
        index: 8,
        virtualRows: [
          { index: 7, start: 168, end: 192 },
          { index: 8, start: 192, end: 216 },
        ],
        scrollOffset: 24,
        viewportHeight: 96,
      }),
    ).toBe(false);
  });

  test("returns false when the row is not currently mounted", () => {
    expect(
      isVirtualRowFullyVisible({
        index: 12,
        virtualRows: [{ index: 4, start: 96, end: 120 }],
        scrollOffset: 72,
        viewportHeight: 96,
      }),
    ).toBe(false);
  });
});
