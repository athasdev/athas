import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { yieldToMain } from "../yield-to-main";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("yieldToMain", () => {
  it("uses the browser scheduler with its receiver", async () => {
    const scheduler = {
      yield: vi.fn(function (this: unknown) {
        expect(this).toBe(scheduler);
        return Promise.resolve();
      }),
    };
    vi.stubGlobal("scheduler", scheduler);
    await yieldToMain();
    expect(scheduler.yield).toHaveBeenCalledOnce();
  });

  it("yields to a new task when the WebView has no scheduler.yield", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("scheduler", {});
    let resumed = false;
    const pending = yieldToMain().then(() => {
      resumed = true;
    });
    await Promise.resolve();
    expect(resumed).toBe(false);
    await vi.runAllTimersAsync();
    await pending;
    expect(resumed).toBe(true);
  });
});
