// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const windowLabel = vi.hoisted(() => ({ current: "main" }));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: windowLabel.current }),
}));

import { commands } from "@/bindings/commands";
import { installDevelopmentPerformanceMeasureCleanup } from "../services/performance-measure-retention";
import {
  recordStartupMilestone,
  recordStartupMilestoneAfterFrame,
} from "../services/startup-performance";

beforeEach(() => {
  windowLabel.current = "main";
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("startup milestones", () => {
  it("records each milestone once for the initial window", async () => {
    const record = vi.spyOn(commands, "recordStartupMilestone").mockResolvedValue(null);

    recordStartupMilestone("frontend:entry");
    recordStartupMilestone("frontend:entry");

    expect(record).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledWith("frontend:entry");
  });

  it("ignores milestones from secondary windows", () => {
    windowLabel.current = "window-2";
    const record = vi.spyOn(commands, "recordStartupMilestone").mockResolvedValue(null);

    recordStartupMilestone("react:scheduled");

    expect(record).not.toHaveBeenCalled();
  });

  it("allows a milestone to be recorded again after a failed attempt", async () => {
    const record = vi
      .spyOn(commands, "recordStartupMilestone")
      .mockRejectedValueOnce(new Error("not ready"))
      .mockResolvedValue(null);

    recordStartupMilestone("workspace:error");
    await new Promise((resolve) => setTimeout(resolve, 0));
    recordStartupMilestone("workspace:error");

    expect(record).toHaveBeenCalledTimes(2);
  });

  it("records after the next frame, or after a fallback timer, but only once", () => {
    vi.useFakeTimers();
    const record = vi.spyOn(commands, "recordStartupMilestone").mockResolvedValue(null);

    recordStartupMilestoneAfterFrame("app:first-frame");
    vi.advanceTimersByTime(200);

    expect(record).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledWith("app:first-frame");
  });

  it("does not record a cancelled after-frame milestone", () => {
    vi.useFakeTimers();
    const record = vi.spyOn(commands, "recordStartupMilestone").mockResolvedValue(null);

    const cancel = recordStartupMilestoneAfterFrame("workbench:first-frame");
    cancel();
    vi.advanceTimersByTime(200);

    expect(record).not.toHaveBeenCalled();
  });
});

describe("development performance cleanup", () => {
  it("clears measures periodically when too many accumulate and when the window hides", () => {
    vi.useFakeTimers();
    const clear = vi.spyOn(performance, "clearMeasures");
    const entries = vi.spyOn(performance, "getEntriesByType").mockReturnValue([]);

    const cleanup = installDevelopmentPerformanceMeasureCleanup();
    vi.advanceTimersByTime(15_000);
    expect(clear).not.toHaveBeenCalled();

    entries.mockReturnValue(Array.from({ length: 501 }, () => ({}) as PerformanceEntry));
    vi.advanceTimersByTime(15_000);
    expect(clear).toHaveBeenCalledOnce();

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(clear).toHaveBeenCalledTimes(2);

    cleanup();
    vi.advanceTimersByTime(30_000);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(clear).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });

  it("replaces a previous installation instead of stacking timers", () => {
    vi.useFakeTimers();
    const clear = vi.spyOn(performance, "clearMeasures");
    vi.spyOn(performance, "getEntriesByType").mockReturnValue(
      Array.from({ length: 600 }, () => ({}) as PerformanceEntry),
    );

    const first = installDevelopmentPerformanceMeasureCleanup();
    const second = installDevelopmentPerformanceMeasureCleanup();
    vi.advanceTimersByTime(15_000);
    expect(clear).toHaveBeenCalledOnce();

    first();
    vi.advanceTimersByTime(15_000);
    expect(clear).toHaveBeenCalledTimes(2);

    second();
    vi.advanceTimersByTime(15_000);
    expect(clear).toHaveBeenCalledTimes(2);
    expect(
      (globalThis as { athasPerformanceMeasureCleanup?: unknown }).athasPerformanceMeasureCleanup,
    ).toBeUndefined();
  });
});
