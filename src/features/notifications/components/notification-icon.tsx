import {
  CheckIcon as Check,
  InfoIcon as Info,
  WarningCircleIcon as WarningCircle,
  XCircleIcon as XCircle,
} from "@/ui/icons";
import type { NotificationEntry } from "@/features/notifications/types/notifications.types";

export function NotificationIcon({ type }: { type: NotificationEntry["type"] }) {
  switch (type) {
    case "success":
      return <Check className="size-3.5 text-success" weight="bold" />;
    case "warning":
      return <WarningCircle className="size-3.5 text-warning" weight="duotone" />;
    case "error":
      return <XCircle className="size-3.5 text-error" weight="duotone" />;
    default:
      return <Info className="size-3.5 text-accent" weight="duotone" />;
  }
}
