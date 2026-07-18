import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class<T> {
    onmessage: (message: T) => void;

    constructor(onmessage: (message: T) => void) {
      this.onmessage = onmessage;
    }
  },
}));

import type { Terminal as XtermTerminal } from "@xterm/xterm";
import type { TerminalEvent } from "../types/terminal.types";
import {
  createTerminalEventChannel,
  getTerminalOutputFlowAction,
  getTerminalSize,
  releaseTerminalEventChannel,
  subscribeToTerminalEvents,
  terminalSizesEqual,
} from "../utils/terminal-protocol";

describe("terminal protocol", () => {
  it("preserves channel event order across creation and subscription", () => {
    const events = createTerminalEventChannel();
    const output: TerminalEvent = { event: "output", data: [0xf0, 0x9f] };
    const closed: TerminalEvent = { event: "closed" };

    events.channel.onmessage(output);
    events.bind("terminal-1");
    events.channel.onmessage(closed);

    const received: TerminalEvent[] = [];
    const unsubscribe = subscribeToTerminalEvents("terminal-1", (event) => received.push(event));

    expect(received).toEqual([output, closed]);
    unsubscribe();
    releaseTerminalEventChannel("terminal-1");
  });

  it("uses high and low watermarks without oscillating between them", () => {
    expect(getTerminalOutputFlowAction(499_999, false)).toBe("none");
    expect(getTerminalOutputFlowAction(500_000, false)).toBe("pause");
    expect(getTerminalOutputFlowAction(100_001, true)).toBe("none");
    expect(getTerminalOutputFlowAction(100_000, true)).toBe("resume");
  });

  it("reports the rendered grid pixels and deduplicates identical sizes", () => {
    const screen = {
      getBoundingClientRect: () => ({ width: 811.4, height: 423.6 }),
    };
    const terminal = {
      rows: 24,
      cols: 80,
      element: {
        querySelector: () => screen,
        getBoundingClientRect: () => ({ width: 900, height: 500 }),
      },
    } as unknown as XtermTerminal;

    const size = getTerminalSize(terminal);

    expect(size).toEqual({ rows: 24, cols: 80, pixelWidth: 811, pixelHeight: 424 });
    expect(terminalSizesEqual(size, { ...size })).toBe(true);
    expect(terminalSizesEqual(size, { ...size, pixelWidth: 812 })).toBe(false);
  });
});
