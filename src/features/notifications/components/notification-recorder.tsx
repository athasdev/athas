import { useEffect } from "react";
import { useSonner } from "sonner";
import type { NotificationType } from "../types/notifications.types";
import { useNotificationsStore } from "../stores/notifications.store";

function getNotificationType(type: string | undefined): NotificationType {
  if (type === "success" || type === "warning" || type === "error") return type;
  return "info";
}

export function NotificationRecorder() {
  const { toasts } = useSonner();
  const record = useNotificationsStore((state) => state.actions.record);

  useEffect(() => {
    for (const toast of toasts) {
      if ("dismiss" in toast || typeof toast.title !== "string") continue;

      const description = typeof toast.description === "string" ? toast.description : undefined;
      record({
        id: String(toast.id),
        message: toast.title,
        description,
        type: getNotificationType(toast.type),
      });
    }
  }, [record, toasts]);

  return null;
}
