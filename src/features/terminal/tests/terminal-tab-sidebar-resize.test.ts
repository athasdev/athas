import { describe, expect, it } from "vite-plus/test";
import {
  getTerminalTabSidebarResizeSide,
  getTerminalTabSidebarResizeWidth,
} from "@/features/terminal/utils/terminal-tab-sidebar-resize";

describe("terminal tab sidebar resize", () => {
  it("resizes from the right edge when tabs are on the left", () => {
    expect(getTerminalTabSidebarResizeSide("left")).toBe("right");
    expect(
      getTerminalTabSidebarResizeWidth({
        position: "left",
        startWidth: 180,
        startX: 500,
        currentX: 560,
      }),
    ).toBe(240);
    expect(
      getTerminalTabSidebarResizeWidth({
        position: "left",
        startWidth: 180,
        startX: 500,
        currentX: 440,
      }),
    ).toBe(120);
  });

  it("resizes from the left edge when tabs are on the right", () => {
    expect(getTerminalTabSidebarResizeSide("right")).toBe("left");
    expect(
      getTerminalTabSidebarResizeWidth({
        position: "right",
        startWidth: 180,
        startX: 500,
        currentX: 440,
      }),
    ).toBe(240);
    expect(
      getTerminalTabSidebarResizeWidth({
        position: "right",
        startWidth: 180,
        startX: 500,
        currentX: 560,
      }),
    ).toBe(120);
  });
});
