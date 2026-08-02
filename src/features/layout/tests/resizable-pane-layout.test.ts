import { describe, expect, it } from "vitest";
import {
  clampResponsivePaneWidth,
  getResponsivePaneMaxWidth,
  MIN_RESPONSIVE_PANE_WIDTH,
} from "../utils/resizable-pane-layout";

describe("resizable pane layout", () => {
  it("reserves room for peer panes and the main content area", () => {
    expect(getResponsivePaneMaxWidth(1200, 440)).toBe(400);
    expect(
      clampResponsivePaneWidth({
        value: 520,
        minWidth: 140,
        viewportWidth: 1200,
        reservedWidth: 440,
      }),
    ).toBe(400);
  });

  it("keeps the stored width when the viewport has enough room", () => {
    expect(
      clampResponsivePaneWidth({
        value: 320,
        minWidth: 140,
        viewportWidth: 1440,
        reservedWidth: 360,
      }),
    ).toBe(320);
  });

  it("can contract below the nominal pane minimum on very narrow windows", () => {
    expect(
      clampResponsivePaneWidth({
        value: 320,
        minWidth: 140,
        viewportWidth: 640,
        reservedWidth: 300,
      }),
    ).toBe(MIN_RESPONSIVE_PANE_WIDTH);
  });
});
