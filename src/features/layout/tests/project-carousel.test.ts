import { describe, expect, it } from "vitest";
import {
  getAdjacentProjectIndex,
  getProjectCarouselDirection,
} from "@/features/layout/utils/project-carousel";

describe("project carousel", () => {
  it("moves through projects without wrapping past the final project", () => {
    expect(getAdjacentProjectIndex(0, 1, 3)).toBe(1);
    expect(getAdjacentProjectIndex(1, 1, 3)).toBe(2);
    expect(getAdjacentProjectIndex(2, 1, 3)).toBeNull();
    expect(getAdjacentProjectIndex(0, 1, 1)).toBeNull();
  });

  it("does not wrap backward from the first project", () => {
    expect(getAdjacentProjectIndex(0, -1, 3)).toBeNull();
  });

  it("uses the target position for direct project selection", () => {
    expect(getProjectCarouselDirection(0, 2)).toBe(1);
    expect(getProjectCarouselDirection(2, 0)).toBe(-1);
    expect(getProjectCarouselDirection(1, 1)).toBeNull();
  });
});
