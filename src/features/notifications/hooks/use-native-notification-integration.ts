import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useMemo } from "react";
import { useNotificationsStore } from "@/features/notifications/stores/notifications.store";
import { IS_MAC } from "@/utils/platform";

export function useNativeNotificationIntegration() {
  const notifications = useNotificationsStore.use.notifications();
  const unreadCount = useMemo(
    () =>
      notifications.filter((notification) => !notification.read && notification.type !== "success")
        .length,
    [notifications],
  );

  useEffect(() => {
    if (!IS_MAC) return;
    void getCurrentWindow()
      .setBadgeCount(unreadCount > 0 ? unreadCount : undefined)
      .catch((error) => console.error("Failed to synchronize Dock badge:", error));
  }, [unreadCount]);
}
