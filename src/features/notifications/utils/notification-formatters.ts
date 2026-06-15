import type { NotificationEntry } from "@/ui/toast";
import { formatCalendarDateGroup, formatCompactRelativeDate } from "@/utils/date";

export function formatNotificationAge(timestamp: number) {
  return formatCompactRelativeDate(timestamp, {
    afterWeek: "days",
    capitalizeJustNow: true,
  });
}

export function formatNotificationText(notification: NotificationEntry) {
  return [
    notification.message,
    notification.description,
    `${notification.type} - ${formatNotificationAge(notification.updatedAt)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function formatNotificationGroupDate(timestamp: number) {
  return formatCalendarDateGroup(timestamp);
}
