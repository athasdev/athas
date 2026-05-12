import { describe, expect, it } from "vite-plus/test";
import { getIndentGuideColumns, getIndentGuidesForLine } from "../utils/indent-guides";

describe("indent guides", () => {
  it("creates guides at configured space indent levels", () => {
    expect(getIndentGuideColumns("    value", 2)).toEqual([2, 4]);
  });

  it("expands tabs to the next tab stop", () => {
    expect(getIndentGuideColumns("\t  value", 4)).toEqual([4]);
  });

  it("marks the deepest guide before the active column", () => {
    expect(getIndentGuidesForLine("      value", 2, 5)).toEqual([
      { column: 2, active: false },
      { column: 4, active: true },
      { column: 6, active: false },
    ]);
  });
});
