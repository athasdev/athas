import { describe, expect, it } from "vitest";
import { getOutlineRevealScrollTop } from "../utils/outline-scroll";

describe("getOutlineRevealScrollTop", () => {
  it("does not move a row that is already fully visible", () => {
    expect(
      getOutlineRevealScrollTop({
        scrollTop: 120,
        viewportTop: 100,
        viewportBottom: 300,
        rowTop: 140,
        rowBottom: 164,
      }),
    ).toBeNull();
  });

  it("reveals only the clipped portion above the viewport", () => {
    expect(
      getOutlineRevealScrollTop({
        scrollTop: 120,
        viewportTop: 100,
        viewportBottom: 300,
        rowTop: 92,
        rowBottom: 116,
      }),
    ).toBe(108);
  });

  it("reveals only the clipped portion below the viewport", () => {
    expect(
      getOutlineRevealScrollTop({
        scrollTop: 120,
        viewportTop: 100,
        viewportBottom: 300,
        rowTop: 286,
        rowBottom: 310,
      }),
    ).toBe(134);
  });

  it("does not scroll above the start of the outline", () => {
    expect(
      getOutlineRevealScrollTop({
        scrollTop: 2,
        viewportTop: 100,
        viewportBottom: 300,
        rowTop: 80,
        rowBottom: 104,
      }),
    ).toBe(0);
  });
});
