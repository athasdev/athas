import { describe, expect, it } from "vite-plus/test";
import type { GitHubNotification } from "../types/github.types";
import {
  filterGitHubNotifications,
  getGitHubNotificationDateGroup,
  groupGitHubNotificationsByDate,
} from "../utils/github-notification-list";

const notification = (id: string, subjectType: string, updatedAt: string): GitHubNotification => ({
  id,
  title: `Notification ${id}`,
  subjectType,
  reason: "subscribed",
  unread: true,
  updatedAt,
  lastReadAt: null,
  repositoryFullName: "athasdev/athas",
  url: "https://github.com/athasdev/athas",
  subjectUrl: "",
});

describe("GitHub notification list", () => {
  it("filters workflow and code notifications", () => {
    const notifications = [
      notification("1", "CheckSuite", "2026-08-14T12:00:00Z"),
      notification("2", "PullRequest", "2026-08-14T11:00:00Z"),
      notification("3", "Issue", "2026-08-14T10:00:00Z"),
      notification("4", "Release", "2026-08-14T09:00:00Z"),
    ];

    expect(filterGitHubNotifications(notifications, "workflows").map(({ id }) => id)).toEqual([
      "1",
    ]);
    expect(
      filterGitHubNotifications(notifications, "pulls-and-issues").map(({ id }) => id),
    ).toEqual(["2", "3"]);
  });

  it("groups notifications by readable date periods", () => {
    const now = new Date("2026-08-14T18:00:00Z");
    const notifications = [
      notification("today", "Issue", "2026-08-14T12:00:00Z"),
      notification("yesterday", "Issue", "2026-08-13T12:00:00Z"),
      notification("week", "Issue", "2026-08-11T12:00:00Z"),
      notification("earlier", "Issue", "2026-08-01T12:00:00Z"),
    ];

    expect(groupGitHubNotificationsByDate(notifications, now).map(({ label }) => label)).toEqual([
      "Today",
      "Yesterday",
      "This week",
      "Earlier",
    ]);
  });

  it("places malformed timestamps in the earlier group", () => {
    expect(getGitHubNotificationDateGroup("not-a-date")).toBe("Earlier");
  });
});
