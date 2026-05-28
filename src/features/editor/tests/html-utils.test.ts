import { describe, expect, it } from "vite-plus/test";
import { applyIncrementalLineOffsetEdit, buildLineOffsetMap } from "../utils/html";

describe("buildLineOffsetMap", () => {
  it("does not reuse cached offsets for different content with the same prefix and length", () => {
    const prefix = "x".repeat(120);
    const first = `${prefix}\nabc`;
    const second = `${prefix}a\nbc`;

    expect(buildLineOffsetMap(first)).toEqual([0, 121]);
    expect(buildLineOffsetMap(second)).toEqual([0, 122]);
  });

  it("updates line offsets incrementally for small edits", () => {
    const previous = "alpha\nbeta\ngamma";
    const previousOffsets = [0, 6, 11];

    expect(
      applyIncrementalLineOffsetEdit(previous, "alpha\nbeta!\ngamma", previousOffsets),
    ).toEqual([0, 6, 12]);

    expect(
      applyIncrementalLineOffsetEdit(previous, "alpha\ninserted\nbeta\ngamma", previousOffsets),
    ).toEqual([0, 6, 15, 20]);

    expect(applyIncrementalLineOffsetEdit(previous, "alpha\ngamma", previousOffsets)).toEqual([
      0, 6,
    ]);
  });

  it("matches full offset rebuild for boundary edits", () => {
    const cases = [
      ["alpha\nbeta\ngamma", "xalpha\nbeta\ngamma"],
      ["alpha\nbeta\ngamma", "alpha\nxbeta\ngamma"],
      ["alpha\nbeta\ngamma", "alpha\nbeta\ngammax"],
      ["alpha\nbeta\ngamma", "alpha\nbeta\n\ngamma"],
      ["alpha\nbeta\ngamma", "alpha\nbe\nta\ngamma"],
      ["alpha\nbeta\ngamma\n", "alpha\nbeta\ngamma\nx"],
      ["alpha\nbeta\ngamma", "alpha\nbeta"],
    ];

    for (const [previous, next] of cases) {
      const previousOffsets = buildLineOffsetMap(previous);
      expect(applyIncrementalLineOffsetEdit(previous, next, previousOffsets)).toEqual(
        buildLineOffsetMap(next),
      );
    }
  });

  it("falls back for large offset edits", () => {
    const previous = "alpha\nbeta";
    expect(
      applyIncrementalLineOffsetEdit(previous, `alpha\n${"x".repeat(1001)}`, [0, 6]),
    ).toBeNull();
  });
});
