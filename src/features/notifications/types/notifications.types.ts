import type { ReactNode } from "react";

export type NotificationType = "info" | "success" | "warning" | "error";

export interface NotificationEntry {
  id: string;
  message: string;
  description?: string;
  type: NotificationType;
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

export type NotificationFilter = "all" | NotificationEntry["type"];

export type NotificationItemAction = {
  id: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  variant?: "default" | "danger";
};
