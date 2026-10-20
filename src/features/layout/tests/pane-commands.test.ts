import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  isPaneReady,
  registerPaneCommands,
  runPaneCommand,
  whenPaneReady,
} from "../services/pane-commands";

afterEach(() => {
  vi.useRealTimers();
});

describe("pane commands", () => {
  it("runs a command at once on a mounted pane", async () => {
    const refresh = vi.fn();
    const stop = registerPaneCommands("view:test", { refresh });
    expect(isPaneReady("view:test")).toBe(true);
    await expect(runPaneCommand("view:test", "refresh", 3)).resolves.toBe(true);
    expect(refresh).toHaveBeenCalledWith(3);
    stop();
    expect(isPaneReady("view:test")).toBe(false);
  });

  it("waits for the pane to mount before running the command", async () => {
    const action = vi.fn();
    const ran = runPaneCommand("view:later", "action", { type: "refresh" });
    await Promise.resolve();
    expect(action).not.toHaveBeenCalled();
    const stop = registerPaneCommands("view:later", { action });
    await expect(ran).resolves.toBe(true);
    expect(action).toHaveBeenCalledWith({ type: "refresh" });
    stop();
  });

  it("gives up when the pane never mounts or lacks the command", async () => {
    vi.useFakeTimers();
    const ready = whenPaneReady("view:never", 1000);
    vi.advanceTimersByTime(1000);
    await expect(ready).resolves.toBeNull();

    const stop = registerPaneCommands("view:other", { refresh: vi.fn() });
    await expect(runPaneCommand("view:other", "missing")).resolves.toBe(false);
    stop();
  });

  it("keeps the newest registration when an older pane unmounts late", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = registerPaneCommands("view:twice", { action: first });
    const stopSecond = registerPaneCommands("view:twice", { action: second });
    stopFirst();
    await runPaneCommand("view:twice", "action");
    expect(second).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
    stopSecond();
  });
});
