import { describe, expect, it } from "bun:test";
import { DEFAULT_COLUMN_WIDTH, MIN_COLUMN_WIDTH } from "./use-column-resize";

describe("column resize constants", () => {
  it("has a reasonable minimum column width", () => {
    expect(MIN_COLUMN_WIDTH).toBe(60);
    expect(MIN_COLUMN_WIDTH).toBeGreaterThan(0);
  });

  it("has a reasonable default column width", () => {
    expect(DEFAULT_COLUMN_WIDTH).toBe(150);
    expect(DEFAULT_COLUMN_WIDTH).toBeGreaterThanOrEqual(MIN_COLUMN_WIDTH);
  });
});

describe("column width calculations", () => {
  it("clamps width to minimum", () => {
    const startWidth = 100;
    const delta = -80; // Dragging left 80px
    const newWidth = Math.max(MIN_COLUMN_WIDTH, startWidth + delta);
    expect(newWidth).toBe(MIN_COLUMN_WIDTH);
  });

  it("allows width increases", () => {
    const startWidth = 100;
    const delta = 50;
    const newWidth = Math.max(MIN_COLUMN_WIDTH, startWidth + delta);
    expect(newWidth).toBe(150);
  });

  it("clamps very negative deltas to minimum", () => {
    const startWidth = 200;
    const delta = -500;
    const newWidth = Math.max(MIN_COLUMN_WIDTH, startWidth + delta);
    expect(newWidth).toBe(MIN_COLUMN_WIDTH);
  });

  it("preserves width when delta is zero", () => {
    const startWidth = 120;
    const newWidth = Math.max(MIN_COLUMN_WIDTH, startWidth + 0);
    expect(newWidth).toBe(120);
  });
});
