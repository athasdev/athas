import { describe, expect, it } from "vite-plus/test";
import { getUiRootAttributes, shouldShowTabCloseButton } from "../lib/ui-preferences";

describe("UI preferences", () => {
  it("maps UI settings to stable root attributes", () => {
    expect(
      getUiRootAttributes({
        reduceMotion: true,
      }),
    ).toEqual({
      "data-reduce-motion": "true",
    });
  });

  it("keeps system motion behavior by default", () => {
    expect(
      getUiRootAttributes({
        reduceMotion: false,
      }),
    ).toEqual({
      "data-reduce-motion": "system",
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
