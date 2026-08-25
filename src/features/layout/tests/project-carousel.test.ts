import { describe, expect, it } from "vitest";
import {
  getProjectCarouselPageIndex,
  getProjectCarouselWindow,
} from "@/features/layout/utils/project-carousel";

describe("project carousel", () => {
  it("renders only the current project and its available neighbors", () => {
    const projects = ["alpha", "beta", "gamma", "delta"];

    expect(getProjectCarouselWindow(projects, 0)).toEqual(["alpha", "beta"]);
    expect(getProjectCarouselWindow(projects, 2)).toEqual(["beta", "gamma", "delta"]);
    expect(getProjectCarouselWindow(projects, 3)).toEqual(["gamma", "delta"]);
  });

  it("returns no panels when the current project is unavailable", () => {
    expect(getProjectCarouselWindow(["alpha"], -1)).toEqual([]);
    expect(getProjectCarouselWindow(["alpha"], 1)).toEqual([]);
  });

  it("selects the page nearest the native scroll snap position", () => {
    expect(getProjectCarouselPageIndex(0, 160, 3)).toBe(0);
    expect(getProjectCarouselPageIndex(159, 160, 3)).toBe(1);
    expect(getProjectCarouselPageIndex(321, 160, 3)).toBe(2);
  });

  it("clamps elastic overscroll to an available page", () => {
    expect(getProjectCarouselPageIndex(-30, 160, 3)).toBe(0);
    expect(getProjectCarouselPageIndex(600, 160, 3)).toBe(2);
  });

  it("rejects invalid scroll geometry", () => {
    expect(getProjectCarouselPageIndex(0, 0, 3)).toBeNull();
    expect(getProjectCarouselPageIndex(Number.NaN, 160, 3)).toBeNull();
    expect(getProjectCarouselPageIndex(0, 160, 0)).toBeNull();
  });
});
