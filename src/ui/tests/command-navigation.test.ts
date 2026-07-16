import { describe, expect, it } from "vite-plus/test";
import { clampCommandListIndex, moveCommandListIndex } from "../command-navigation";

describe("command list keyboard navigation", () => {
  it("moves down and up within the available items", () => {
    expect(moveCommandListIndex(0, 4, "next")).toBe(1);
    expect(moveCommandListIndex(2, 4, "previous")).toBe(1);
  });

  it("stays inside the first and last item", () => {
    expect(moveCommandListIndex(3, 4, "next")).toBe(3);
    expect(moveCommandListIndex(0, 4, "previous")).toBe(0);
  });

  it("clamps stale selection when results shrink", () => {
    expect(clampCommandListIndex(8, 3)).toBe(2);
    expect(clampCommandListIndex(2, 0)).toBe(0);
  });
});
