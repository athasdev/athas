import { useEffect, useMemo, useState } from "react";
import { useCommandShortcut } from "@/features/keymaps/hooks/use-command-shortcut";
import { NotificationsCommand } from "@/features/notifications/components/notifications-command";
import { OPEN_NOTIFICATIONS_COMMAND_EVENT } from "@/features/notifications/constants/notifications-events";
import { useNotificationsStore } from "@/features/notifications/stores/notifications.store";
import { Button } from "@/ui/button";
import { BellIcon } from "@/ui/icons";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";

interface NotificationsTriggerProps {
  className?: string;
}

export const NotificationsTrigger = ({ className }: NotificationsTriggerProps) => {
  const notifications = useNotificationsStore.use.notifications();
  const [isCommandVisible, setIsCommandVisible] = useState(false);
  const shortcut = useCommandShortcut("workbench.showNotifications");
  const unreadCount = useMemo(
    () =>
      notifications.filter((notification) => !notification.read && notification.type !== "success")
        .length,
    [notifications],
  );

  useEffect(() => {
    const handleShowNotifications = () => setIsCommandVisible(true);

    window.addEventListener(OPEN_NOTIFICATIONS_COMMAND_EVENT, handleShowNotifications);
    return () => {
      window.removeEventListener(OPEN_NOTIFICATIONS_COMMAND_EVENT, handleShowNotifications);
    };
  }, []);

  return (
    <>
      <Tooltip content="Notifications" shortcut={shortcut} side="top">
        <Button
          onClick={() => {
            window.dispatchEvent(new CustomEvent(OPEN_NOTIFICATIONS_COMMAND_EVENT));
          }}
          type="button"
          variant="ghost"
          size="xs"
          active={isCommandVisible}
          className={cn(className, unreadCount > 0 && "w-auto gap-1.5")}
          aria-label="Notifications"
        >
          <BellIcon />
          {unreadCount > 0 && (
            <span className="font-sans ui-text-sm pointer-events-none font-medium tabular-nums text-current">
              {unreadCount}
            </span>
          )}
        </Button>
      </Tooltip>
      <NotificationsCommand
        isVisible={isCommandVisible}
        onClose={() => setIsCommandVisible(false)}
      />
    </>
  );
};
