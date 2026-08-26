import { describe, expect, it } from "vite-plus/test";
import { clampCommandListIndex, moveCommandListIndex } from "./command";

describe("command list navigation", () => {
  it("clamps selection to the available items", () => {
    expect(clampCommandListIndex(-1, 4)).toBe(0);
    expect(clampCommandListIndex(2, 4)).toBe(2);
    expect(clampCommandListIndex(8, 4)).toBe(3);
    expect(clampCommandListIndex(0, 0)).toBe(0);
  });

  it("moves selection without passing either edge", () => {
    expect(moveCommandListIndex(0, 3, "previous")).toBe(0);
    expect(moveCommandListIndex(0, 3, "next")).toBe(1);
    expect(moveCommandListIndex(2, 3, "next")).toBe(2);
  });
});
