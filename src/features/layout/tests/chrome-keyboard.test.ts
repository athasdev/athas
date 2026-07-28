import { describe, expect, it } from "vite-plus/test";
import { getChromeNavigationIndex } from "@/features/layout/utils/chrome-keyboard";

describe("chrome keyboard navigation", () => {
  it("moves horizontally and keeps focus inside the strip", () => {
    expect(getChromeNavigationIndex("ArrowRight", 0, 3, "horizontal")).toBe(1);
    expect(getChromeNavigationIndex("ArrowLeft", 0, 3, "horizontal")).toBe(0);
    expect(getChromeNavigationIndex("ArrowRight", 2, 3, "horizontal")).toBe(2);
  });

  it("moves vertically without treating horizontal keys as navigation", () => {
    expect(getChromeNavigationIndex("ArrowDown", 0, 3, "vertical")).toBe(1);
    expect(getChromeNavigationIndex("ArrowUp", 2, 3, "vertical")).toBe(1);
    expect(getChromeNavigationIndex("ArrowRight", 1, 3, "vertical")).toBeNull();
  });

  it("supports Home and End in every orientation", () => {
    expect(getChromeNavigationIndex("Home", 2, 4, "horizontal")).toBe(0);
    expect(getChromeNavigationIndex("End", 0, 4, "vertical")).toBe(3);
  });
});
