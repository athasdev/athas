import { describe, expect, it } from "vite-plus/test";
import { calculateAspectRatioDimensions } from "../editor/utils/canvas-utils";

describe("aspect ratio resizing", () => {
  it("keeps the original size when no target is given", () => {
    expect(calculateAspectRatioDimensions(1920, 1080)).toEqual({ width: 1920, height: 1080 });
  });

  it("derives the missing side from a single target", () => {
    expect(calculateAspectRatioDimensions(1920, 1080, 960)).toEqual({ width: 960, height: 540 });
    expect(calculateAspectRatioDimensions(1920, 1080, undefined, 270)).toEqual({
      width: 480,
      height: 270,
    });
  });

  it("fits inside both targets using the tighter side", () => {
    expect(calculateAspectRatioDimensions(1920, 1080, 800, 800)).toEqual({
      width: 800,
      height: 450,
    });
    expect(calculateAspectRatioDimensions(1080, 1920, 800, 800)).toEqual({
      width: 450,
      height: 800,
    });
  });

  it("scales up when both targets are larger", () => {
    expect(calculateAspectRatioDimensions(100, 50, 400, 400)).toEqual({ width: 400, height: 200 });
  });

  it("rounds to whole pixels", () => {
    expect(calculateAspectRatioDimensions(3, 2, 100)).toEqual({ width: 100, height: 67 });
  });
});
