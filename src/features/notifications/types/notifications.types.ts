import type { ReactNode } from "react";

export type NotificationType = "info" | "success" | "warning" | "error";
export type NotificationCategory = "athas" | "agent";
export type NotificationCategoryFilter = "all" | NotificationCategory | "github";

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

export interface ToastInput {
  key?: string;
  message: string;
  description?: string;
  type: NotificationType;
  duration?: number;
  icon?: ReactNode;
  action?: {
    label: string;
    onClick: () => void;
  };
}
