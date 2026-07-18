import type { ReactNode } from "react";
import type { NotificationEntry } from "@/ui/toast";

export type NotificationFilter = "all" | NotificationEntry["type"];

export type NotificationItemAction = {
  id: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  variant?: "default" | "danger";
};
