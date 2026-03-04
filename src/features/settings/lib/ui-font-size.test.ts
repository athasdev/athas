import { describe, expect, it } from "bun:test";
import {
  formatUiFontSize,
  getUiFontScale,
  normalizeUiFontSize,
  shiftUiFontSize,
  UI_FONT_SIZE_DEFAULT,
  UI_FONT_SIZE_MAX,
  UI_FONT_SIZE_MIN,
} from "./ui-font-size";

describe("ui-font-size helpers", () => {
  it("uses default size for invalid values", () => {
    expect(normalizeUiFontSize(undefined)).toBe(UI_FONT_SIZE_DEFAULT);
    expect(normalizeUiFontSize(null)).toBe(UI_FONT_SIZE_DEFAULT);
    expect(normalizeUiFontSize("invalid")).toBe(UI_FONT_SIZE_DEFAULT);
  });

  it("snaps values to 0.5px increments and clamps to range", () => {
    expect(normalizeUiFontSize(14.26)).toBe(14.5);
    expect(normalizeUiFontSize(9.2)).toBe(UI_FONT_SIZE_MIN);
    expect(normalizeUiFontSize(99)).toBe(UI_FONT_SIZE_MAX);
  });

  it("increments and decrements by one step", () => {
    expect(shiftUiFontSize(14, 1)).toBe(14.5);
    expect(shiftUiFontSize(14, -1)).toBe(13.5);
  });

  it("does not move outside min and max bounds", () => {
    expect(shiftUiFontSize(UI_FONT_SIZE_MIN, -1)).toBe(UI_FONT_SIZE_MIN);
    expect(shiftUiFontSize(UI_FONT_SIZE_MAX, 1)).toBe(UI_FONT_SIZE_MAX);
  });

  it("formats values with two decimals and exposes stable scale", () => {
    expect(formatUiFontSize(14)).toBe("14.00");
    expect(getUiFontScale(UI_FONT_SIZE_DEFAULT)).toBe(1);
    expect(getUiFontScale(17.5)).toBe(1.25);
  });
});
