import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { getSidebarTime } from "../utils/github-viewer-utils";

afterEach(() => vi.useRealTimers());

describe("GitHub sidebar time", () => {
  it("uses short numeric units without ago or yesterday", () => {
    vi.useFakeTimers();
    const now = new Date("2026-09-08T12:00:00Z").getTime();
    vi.setSystemTime(now);
    for (const [age, label] of [
      [0, "0m"],
      [300_000, "5m"],
      [7_200_000, "2h"],
      [86_400_000, "1d"],
      [864_000_000, "10d"],
    ] as const) {
      expect(getSidebarTime(new Date(now - age).toISOString())).toBe(label);
    }
    expect(getSidebarTime("invalid")).toBe("—");
  });
});
