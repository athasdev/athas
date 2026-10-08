import { describe, expect, it } from "vite-plus/test";
import { reorderProjectTabItems } from "../utils/project-tab-order";

describe("project tab order", () => {
  it("moves an item from one index to another", () => {
    expect(reorderProjectTabItems(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
  });

  it("preserves the same array for no-op moves", () => {
    const items = ["a", "b", "c"];
    expect(reorderProjectTabItems(items, 1, 1)).toBe(items);
  });

  it("ignores invalid indexes", () => {
    const items = ["a", "b", "c"];

    expect(reorderProjectTabItems(items, -1, 1)).toBe(items);
    expect(reorderProjectTabItems(items, 1, -1)).toBe(items);
    expect(reorderProjectTabItems(items, 3, 1)).toBe(items);
    expect(reorderProjectTabItems(items, 1, 3)).toBe(items);
  });
});
