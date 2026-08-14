import type { GitHubNotification } from "../types/github.types";

export type GitHubNotificationFilter = "all" | "pulls-and-issues" | "workflows";

export const GITHUB_NOTIFICATION_PAGE_SIZE = 12;

export function filterGitHubNotifications(
  notifications: GitHubNotification[],
  filter: GitHubNotificationFilter,
): GitHubNotification[] {
  if (filter === "pulls-and-issues") {
    return notifications.filter(
      (notification) =>
        notification.subjectType === "PullRequest" || notification.subjectType === "Issue",
    );
  }

  if (filter === "workflows") {
    return notifications.filter((notification) => notification.subjectType === "CheckSuite");
  }

  return notifications;
}

export function getGitHubNotificationDateGroup(value: string, now = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Earlier";

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const thisWeek = new Date(today);
  thisWeek.setDate(today.getDate() - ((today.getDay() + 6) % 7));

  if (date >= today) return "Today";
  if (date >= yesterday) return "Yesterday";
  if (date >= thisWeek) return "This week";
  return "Earlier";
}

export function groupGitHubNotificationsByDate(
  notifications: GitHubNotification[],
  now = new Date(),
): Array<{ label: string; notifications: GitHubNotification[] }> {
  const groups = new Map<string, GitHubNotification[]>();

  for (const notification of notifications) {
    const label = getGitHubNotificationDateGroup(notification.updatedAt, now);
    const group = groups.get(label);
    if (group) group.push(notification);
    else groups.set(label, [notification]);
  }

  return Array.from(groups, ([label, groupedNotifications]) => ({
    label,
    notifications: groupedNotifications,
  }));
}
