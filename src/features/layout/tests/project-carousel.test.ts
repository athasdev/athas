import { describe, expect, it } from "vitest";
import {
  getAdjacentProjectIndex,
  getProjectCarouselDirection,
  getProjectSnapDuration,
  getProjectSwipeBounds,
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

  it("hard-stops the rail where an adjacent project does not exist", () => {
    expect(getProjectSwipeBounds(false, true, 160)).toEqual({ left: -160, right: 0 });
    expect(getProjectSwipeBounds(true, false, 160)).toEqual({ left: 0, right: 160 });
    expect(getProjectSwipeBounds(false, false, 160)).toEqual({ left: 0, right: 0 });
  });

  it("uses the target position for direct project selection", () => {
    expect(getProjectCarouselDirection(0, 2)).toBe(1);
    expect(getProjectCarouselDirection(2, 0)).toBe(-1);
    expect(getProjectCarouselDirection(1, 1)).toBeNull();
  });

  it("finishes near-complete swipes without stretching the final pixels", () => {
    expect(getProjectSnapDuration(-144, -160, 160)).toBe(0.035);
    expect(getProjectSnapDuration(-40, -160, 160)).toBeCloseTo(0.105);
    expect(getProjectSnapDuration(0, -160, 160)).toBe(0.14);
  });
});
