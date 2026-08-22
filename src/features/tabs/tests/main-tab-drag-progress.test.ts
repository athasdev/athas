import { describe, expect, it } from "vite-plus/test";
import { getMainTabDragProgress } from "../utils/main-tab-drag-progress";

describe("main tab drag progress", () => {
  it("maps drag distance to a bounded corner progress", () => {
    expect(getMainTabDragProgress(-5)).toBe(0);
    expect(getMainTabDragProgress(0)).toBe(0);
    expect(getMainTabDragProgress(12)).toBe(0.5);
    expect(getMainTabDragProgress(24)).toBe(1);
    expect(getMainTabDragProgress(80)).toBe(1);
  });
});
