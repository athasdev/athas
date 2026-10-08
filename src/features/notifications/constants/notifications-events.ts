import type { NotificationCategoryFilter } from "@/features/notifications/types/notifications.types";

export interface OpenNotificationsCommandDetail {
  category?: NotificationCategoryFilter;
}
