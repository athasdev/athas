import { describe, expect, it, vi } from "vite-plus/test";
import { clearExcessPerformanceMeasures } from "../performance-measure-retention";

function createMeasureStore(measureCount: number) {
  return {
    clearMeasures: vi.fn(),
    getEntriesByType: vi.fn(() =>
      Array.from({ length: measureCount }, () => ({}) as PerformanceEntry),
    ),
  };
}

describe("performance measure retention", () => {
  it("clears an oversized performance timeline", () => {
    const measureStore = createMeasureStore(501);

    expect(clearExcessPerformanceMeasures(measureStore)).toBe(true);
    expect(measureStore.clearMeasures).toHaveBeenCalledOnce();
  });

  it("preserves a bounded performance timeline", () => {
    const measureStore = createMeasureStore(500);

    expect(clearExcessPerformanceMeasures(measureStore)).toBe(false);
    expect(measureStore.clearMeasures).not.toHaveBeenCalled();
  });
});
