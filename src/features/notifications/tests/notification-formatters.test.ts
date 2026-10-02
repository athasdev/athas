import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { NotificationEntry } from "../types/notifications.types";
import { formatNotificationAge, formatNotificationText } from "../utils/notification-formatters";

const NOW = new Date(2026, 5, 15, 12, 0, 0).getTime();
const DAY = 86_400_000;

function entry(overrides: Partial<NotificationEntry> = {}): NotificationEntry {
  return {
    id: "n",
    message: "Build failed",
    type: "error",
    category: "athas",
    createdAt: NOW,
    updatedAt: NOW,
    read: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("notification formatters", () => {
  it("shows ages in minutes, hours, and days, never switching to weeks or dates", () => {
    expect(formatNotificationAge(NOW - 10_000)).toBe("Just now");
    expect(formatNotificationAge(NOW - 5 * 60_000)).toBe("5m ago");
    expect(formatNotificationAge(NOW - 3 * 3_600_000)).toBe("3h ago");
    expect(formatNotificationAge(NOW - DAY)).toBe("1d ago");
    expect(formatNotificationAge(NOW - 30 * DAY)).toBe("30d ago");
  });

  it("copies the message, description, and type with the age", () => {
    expect(
      formatNotificationText(
        entry({ description: "3 errors in main.rs", updatedAt: NOW - 2 * 60_000 }),
      ),
    ).toBe("Build failed\n\n3 errors in main.rs\n\nerror - 2m ago");
  });

  it("omits a missing description instead of leaving an empty paragraph", () => {
    expect(formatNotificationText(entry({ type: "info" }))).toBe("Build failed\n\ninfo - Just now");
  });
});
