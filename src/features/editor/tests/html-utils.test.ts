import { describe, expect, it } from "vite-plus/test";
import { buildLineOffsetMap } from "../utils/html";

describe("buildLineOffsetMap", () => {
  it("does not reuse cached offsets for different content with the same prefix and length", () => {
    const prefix = "x".repeat(120);
    const first = `${prefix}\nabc`;
    const second = `${prefix}a\nbc`;

    expect(buildLineOffsetMap(first)).toEqual([0, 121]);
    expect(buildLineOffsetMap(second)).toEqual([0, 122]);
  });
});
