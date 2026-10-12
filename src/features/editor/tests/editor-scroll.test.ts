import { describe, expect, it } from "vite-plus/test";
import { getEditorBottomScrollPadding } from "../utils/scroll-padding";

describe("editor bottom safe area", () => {
  it("keeps half of the viewport below the last line", () => {
    expect(getEditorBottomScrollPadding(800)).toBe(400);
    expect(getEditorBottomScrollPadding(721)).toBe(361);
  });

  it("disables padding when the viewport is unavailable", () => {
    expect(getEditorBottomScrollPadding(0)).toBe(0);
    expect(getEditorBottomScrollPadding(Number.NaN)).toBe(0);
  });
});
