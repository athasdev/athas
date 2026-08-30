import { useEffect, useMemo, useState } from "react";
import { useCommandShortcut } from "@/features/keymaps/hooks/use-command-shortcut";
import { NotificationsCommand } from "@/features/notifications/components/notifications-command";
import {
  OPEN_NOTIFICATIONS_COMMAND_EVENT,
  type OpenNotificationsCommandDetail,
} from "@/features/notifications/constants/notifications-events";
import { useGitHubNotifications } from "@/features/notifications/hooks/use-github-notifications";
import { useNotificationsStore } from "@/features/notifications/stores/notifications.store";
import type { NotificationCategoryFilter } from "@/features/notifications/types/notifications.types";
import { Button } from "@/ui/button";
import { BellIcon } from "@/ui/icons";

export const NotificationsTrigger = () => {
  const notifications = useNotificationsStore.use.notifications();
  const github = useGitHubNotifications();
  const [isCommandVisible, setIsCommandVisible] = useState(false);
  const [initialCategory, setInitialCategory] = useState<NotificationCategoryFilter>("all");
  const shortcut = useCommandShortcut("workbench.showNotifications");
  const unreadCount = useMemo(
    () =>
      notifications.filter((notification) => !notification.read && notification.type !== "success")
        .length + github.notifications.length,
    [github.notifications.length, notifications],
  );

  useEffect(() => {
    const handleShowNotifications = (event: Event) => {
      const detail = (event as CustomEvent<OpenNotificationsCommandDetail>).detail;
      setInitialCategory(detail?.category ?? "all");
      setIsCommandVisible(true);
    };

    window.addEventListener(OPEN_NOTIFICATIONS_COMMAND_EVENT, handleShowNotifications);
    return () => {
      window.removeEventListener(OPEN_NOTIFICATIONS_COMMAND_EVENT, handleShowNotifications);
    };
  }, []);

  const tooltip = unreadCount > 0 ? `Notifications (${unreadCount})` : "Notifications";

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        iconOnly
        size="chrome"
        onClick={() => {
          setInitialCategory("all");
          setIsCommandVisible(true);
        }}
        active={isCommandVisible}
        tooltip={tooltip}
        shortcut={shortcut}
        aria-label={tooltip}
        className="relative"
      >
        <BellIcon />
        {unreadCount > 0 ? (
          <span className="absolute top-0 right-0 size-1.5 rounded-full bg-primary ring-1 ring-background" />
        ) : null}
      </Button>
      <NotificationsCommand
        isVisible={isCommandVisible}
        initialCategory={initialCategory}
        github={github}
        onClose={() => setIsCommandVisible(false)}
      />
    </>
  );
};
