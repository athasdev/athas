import { describe, expect, it } from "vite-plus/test";
import { DEFAULT_FILE_NAVIGATOR_WIDTH, getFileNavigatorLayout } from "../lib/file-navigator-layout";

describe("getFileNavigatorLayout", () => {
  it("keeps the preferred width when the parent has room", () => {
    expect(getFileNavigatorLayout(DEFAULT_FILE_NAVIGATOR_WIDTH, 800)).toEqual({
      width: 224,
      minWidth: 176,
      maxWidth: 400,
    });
  });

  it("caps the navigator at half of a narrowing parent", () => {
    expect(getFileNavigatorLayout(DEFAULT_FILE_NAVIGATOR_WIDTH, 360)).toEqual({
      width: 180,
      minWidth: 176,
      maxWidth: 180,
    });
  });

  it("shrinks below the preferred minimum to preserve adjacent content", () => {
    expect(getFileNavigatorLayout(DEFAULT_FILE_NAVIGATOR_WIDTH, 240)).toEqual({
      width: 120,
      minWidth: 120,
      maxWidth: 120,
    });
  });

  it("limits a manually widened navigator when its parent contracts", () => {
    expect(getFileNavigatorLayout(400, 600)).toEqual({
      width: 300,
      minWidth: 176,
      maxWidth: 300,
    });
  });
});
