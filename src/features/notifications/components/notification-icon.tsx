import { CheckIcon, InfoIcon, WarningCircleIcon, XCircleIcon } from "@/ui/icons";
import type { NotificationEntry } from "@/features/notifications/types/notifications.types";

export function NotificationIcon({ type }: { type: NotificationEntry["type"] }) {
  switch (type) {
    case "success":
      return <CheckIcon className="size-3.5 text-success" optical="md" />;
    case "warning":
      return <WarningCircleIcon className="size-3.5 text-warning" />;
    case "error":
      return <XCircleIcon className="size-3.5 text-destructive" />;
    default:
      return <InfoIcon className="size-3.5 text-primary" />;
  }
}
