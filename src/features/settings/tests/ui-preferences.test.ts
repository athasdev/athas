import { describe, expect, it } from "vite-plus/test";
import {
  getUiRootAttributes,
  normalizeUiDensity,
  shouldShowTabCloseButton,
} from "../services/ui-preferences";

describe("UI preferences", () => {
  it("maps UI settings to stable root attributes", () => {
    expect(
      getUiRootAttributes({
        reduceMotion: true,
      }),
    ).toEqual({
      "data-reduce-motion": "true",
      "data-ui-density": "compact",
    });
  });

  it("keeps system motion behavior by default", () => {
    expect(
      getUiRootAttributes({
        reduceMotion: false,
      }),
    ).toEqual({
      "data-reduce-motion": "system",
      "data-ui-density": "compact",
    });
  });

  it("controls tab close buttons without hiding pinned tab actions", () => {
    expect(shouldShowTabCloseButton("active", true, false)).toBe(true);
    expect(shouldShowTabCloseButton("active", false, false)).toBe(false);
    expect(shouldShowTabCloseButton("hover", true, false)).toBe(false);
    expect(shouldShowTabCloseButton("always", false, false)).toBe(true);
    expect(shouldShowTabCloseButton("hover", false, true)).toBe(true);
  });

  it("preserves comfortable density and falls back for invalid saved preferences", () => {
    expect(
      getUiRootAttributes({ reduceMotion: false, uiDensity: "comfortable" })["data-ui-density"],
    ).toBe("comfortable");
    for (const value of [undefined, null, "dense", 1, {}]) {
      expect(normalizeUiDensity(value)).toBe("compact");
    }
  });
});
