import { describe, expect, it } from "vite-plus/test";
import { shouldCloseTerminalPane } from "@/features/terminal/utils/terminal-pane-lifecycle";

describe("terminal pane lifecycle", () => {
  it("closes the visible pane when the final terminal is removed", () => {
    expect(
      shouldCloseTerminalPane({
        previousTerminalCount: 1,
        terminalCount: 0,
        isTerminalPaneVisible: true,
      }),
    ).toBe(true);
  });

  it("keeps an empty pane open while its first terminal is being created", () => {
    expect(
      shouldCloseTerminalPane({
        previousTerminalCount: 0,
        terminalCount: 0,
        isTerminalPaneVisible: true,
      }),
    ).toBe(false);
  });

  it("does not close another active bottom pane when the final terminal is removed", () => {
    expect(
      shouldCloseTerminalPane({
        previousTerminalCount: 1,
        terminalCount: 0,
        isTerminalPaneVisible: false,
      }),
    ).toBe(false);
  });
});
