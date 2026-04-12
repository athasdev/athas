import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createInitialCommandDispatcher } from "./initial-command-dispatcher";

describe("initial command dispatcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("waits for terminal output before sending the initial command", () => {
    const send = vi.fn();
    const dispatcher = createInitialCommandDispatcher({
      fallbackDelayMs: 1500,
      schedule: (fn, delay) => setTimeout(fn, delay),
      cancel: (id) => clearTimeout(id),
    });

    dispatcher.arm({
      connectionId: "conn-1",
      command: "bun run dev",
      send,
    });

    vi.advanceTimersByTime(299);
    expect(send).not.toHaveBeenCalled();

    dispatcher.notifyOutput("conn-1");
    expect(send).toHaveBeenCalledWith("bun run dev\n");
  });

  it("falls back to a delayed send if the shell never emits output", () => {
    const send = vi.fn();
    const dispatcher = createInitialCommandDispatcher({
      fallbackDelayMs: 1500,
      schedule: (fn, delay) => setTimeout(fn, delay),
      cancel: (id) => clearTimeout(id),
    });

    dispatcher.arm({
      connectionId: "conn-2",
      command: "npm test",
      send,
    });

    vi.advanceTimersByTime(1499);
    expect(send).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledWith("npm test\n");
  });

  it("sends a command at most once per armed connection", () => {
    const send = vi.fn();
    const dispatcher = createInitialCommandDispatcher({
      fallbackDelayMs: 1500,
      schedule: (fn, delay) => setTimeout(fn, delay),
      cancel: (id) => clearTimeout(id),
    });

    dispatcher.arm({
      connectionId: "conn-3",
      command: "pnpm lint",
      send,
    });

    dispatcher.notifyOutput("conn-3");
    dispatcher.notifyOutput("conn-3");
    vi.advanceTimersByTime(2000);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("pnpm lint\n");
  });
});
