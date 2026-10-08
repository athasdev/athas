import type { ToastType } from "@/utils/toast";

export type NotificationType = ToastType;
export type NotificationCategory = "athas" | "agent" | "github";
export type NotificationCategoryFilter = "all" | NotificationCategory;

export interface NotificationEntry {
  id: string;
  message: string;
  description?: string;
  type: NotificationType;
  category: NotificationCategory;
  createdAt: number;
  updatedAt: number;
  read: boolean;
}
