import { describe, expect, it } from "vite-plus/test";
import { getPaneDropZoneFromRect, getPaneSplitDropOptions } from "../utils/pane-drop-zones";

const rect = {
  left: 100,
  top: 200,
  width: 400,
  height: 300,
};

describe("pane drop zones", () => {
  it("resolves edge-biased split zones from a pane rect", () => {
    expect(getPaneDropZoneFromRect({ x: 120, y: 350 }, rect)).toBe("left");
    expect(getPaneDropZoneFromRect({ x: 480, y: 350 }, rect)).toBe("right");
    expect(getPaneDropZoneFromRect({ x: 300, y: 215 }, rect)).toBe("top");
    expect(getPaneDropZoneFromRect({ x: 300, y: 485 }, rect)).toBe("bottom");
    expect(getPaneDropZoneFromRect({ x: 300, y: 350 }, rect)).toBe("center");
  });

  it("maps split zones to model split options", () => {
    expect(getPaneSplitDropOptions("left")).toEqual({
      direction: "horizontal",
      placement: "before",
    });
    expect(getPaneSplitDropOptions("right")).toEqual({
      direction: "horizontal",
      placement: "after",
    });
    expect(getPaneSplitDropOptions("top")).toEqual({
      direction: "vertical",
      placement: "before",
    });
    expect(getPaneSplitDropOptions("bottom")).toEqual({
      direction: "vertical",
      placement: "after",
    });
    expect(getPaneSplitDropOptions("center")).toBeNull();
    expect(getPaneSplitDropOptions(null)).toBeNull();
  });
});
