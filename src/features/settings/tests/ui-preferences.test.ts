import { describe, expect, it } from "vite-plus/test";
import { getUiRootAttributes, shouldShowTabCloseButton } from "../lib/ui-preferences";

describe("UI preferences", () => {
  it("maps UI settings to stable root attributes", () => {
    expect(
      getUiRootAttributes({
        reduceMotion: true,
        showStatusBar: false,
        windowChromeDensity: "focused",
      }),
    ).toEqual({
      "data-reduce-motion": "true",
      "data-status-bar": "hidden",
      "data-window-chrome-density": "focused",
    });
  });

  it("keeps system motion behavior and the status bar by default", () => {
    expect(
      getUiRootAttributes({
        reduceMotion: false,
        showStatusBar: true,
        windowChromeDensity: "comfortable",
      }),
    ).toEqual({
      "data-reduce-motion": "system",
      "data-status-bar": "visible",
      "data-window-chrome-density": "comfortable",
    });
  });

  it("controls tab close buttons without hiding pinned tab actions", () => {
    expect(shouldShowTabCloseButton("active", true, false)).toBe(true);
    expect(shouldShowTabCloseButton("active", false, false)).toBe(false);
    expect(shouldShowTabCloseButton("hover", true, false)).toBe(false);
    expect(shouldShowTabCloseButton("always", false, false)).toBe(true);
    expect(shouldShowTabCloseButton("hover", false, true)).toBe(true);
  });
});
