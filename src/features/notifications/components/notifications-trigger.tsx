import { useEffect, useMemo, useState } from "react";
import { useCommandShortcut } from "@/features/keymaps/hooks/use-command-shortcut";
import { NotificationsCommand } from "@/features/notifications/components/notifications-command";
import { useGitHubNotifications } from "@/features/notifications/hooks/use-github-notifications";
import { useNotificationsStore } from "@/features/notifications/stores/notifications.store";
import type { NotificationCategoryFilter } from "@/features/notifications/types/notifications.types";
import { Button } from "@/ui/button";
import { BellIcon } from "@/ui/icons";
import { onAppEvent } from "@/utils/app-events";

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
    return onAppEvent("athas:notifications:show", (detail) => {
      setInitialCategory(detail?.category ?? "all");
      setIsCommandVisible(true);
    });
  }, []);

  const tooltip = unreadCount > 0 ? `Notifications (${unreadCount})` : "Notifications";

  return (
    <>
      <span className="inline-flex min-w-0 relative">
        <Button
          type="button"
          variant="ghost"
          iconOnly
          size="lg"
          onClick={() => {
            setInitialCategory("all");
            setIsCommandVisible(true);
          }}
          active={isCommandVisible}
          tooltip={tooltip}
          shortcut={shortcut}
          aria-label={tooltip}
        >
          <BellIcon />
          {unreadCount > 0 ? (
            <span className="absolute top-0 right-0 size-1.5 rounded-full bg-primary ring-1 ring-background" />
          ) : null}
        </Button>
      </span>
      <NotificationsCommand
        isVisible={isCommandVisible}
        initialCategory={initialCategory}
        github={github}
        onClose={() => setIsCommandVisible(false)}
      />
    </>
  );
};
