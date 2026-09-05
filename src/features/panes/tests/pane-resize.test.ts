import { describe, expect, it } from "vite-plus/test";
import { getPaneResizeLimits, resizePanePair, resizePanePairByPixels } from "../utils/pane-resize";

describe("pane resize geometry", () => {
  it("tracks pointer distance in rows with more than two panes", () => {
    expect(resizePanePairByPixels([25, 25], 100, 1000)).toEqual([35, 15]);
    expect(resizePanePairByPixels([50, 50], 100, 1000)).toEqual([60, 40]);
  });

  it("preserves other panes and clamps each neighbor to the same limits", () => {
    expect(resizePanePair([25, 25], -100)).toEqual([5, 45]);
    expect(resizePanePair([25, 25], 100)).toEqual([45, 5]);
    expect(getPaneResizeLimits([25, 25])).toEqual({ min: 5, max: 45, total: 50 });
  });

  it("does not resize a hidden or unmeasured container", () => {
    expect(resizePanePairByPixels([20, 30], 100, 0)).toEqual([20, 30]);
  });
});
