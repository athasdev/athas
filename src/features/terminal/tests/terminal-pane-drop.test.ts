import { describe, expect, it } from "vite-plus/test";
import { getTerminalSplitDropOptions } from "../utils/terminal-pane-drop";

describe("terminal pane drop zones", () => {
  it("maps edges to split directions and placements", () => {
    expect(getTerminalSplitDropOptions("left")).toEqual({
      direction: "right",
      placement: "before",
    });
    expect(getTerminalSplitDropOptions("right")).toEqual({
      direction: "right",
      placement: "after",
    });
    expect(getTerminalSplitDropOptions("top")).toEqual({ direction: "down", placement: "before" });
    expect(getTerminalSplitDropOptions("bottom")).toEqual({
      direction: "down",
      placement: "after",
    });
  });

  it("ignores the center and empty zones", () => {
    expect(getTerminalSplitDropOptions("center")).toBeNull();
    expect(getTerminalSplitDropOptions(null)).toBeNull();
  });
});
