import type { NotificationCategoryFilter } from "@/features/notifications/types/notifications.types";

export const OPEN_NOTIFICATIONS_COMMAND_EVENT = "athas:notifications:show";

export interface OpenNotificationsCommandDetail {
  category?: NotificationCategoryFilter;
}
