import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { formatCompactRelativeDate } from "../date";

describe("formatCompactRelativeDate", () => {
  afterEach(() => vi.useRealTimers());

  it("can omit the ago suffix", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T12:00:00Z"));

    expect(
      formatCompactRelativeDate("2026-08-11T11:55:00Z", {
        includeAgo: false,
      }),
    ).toBe("5m");
  });
});
