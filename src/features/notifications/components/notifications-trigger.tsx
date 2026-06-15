import { BellIcon as Bell } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import {
  chromeControl,
  chromeControlGroup,
  chromeIcon,
} from "@/features/layout/components/chrome-control-styles";
import { useCommandShortcut } from "@/features/keymaps/hooks/use-command-shortcut";
import { NotificationsCommand } from "@/features/notifications/components/notifications-command";
import { OPEN_NOTIFICATIONS_COMMAND_EVENT } from "@/features/notifications/constants/notifications-events";
import { Button } from "@/ui/button";
import { TabsList } from "@/ui/tabs";
import { useToastStore } from "@/ui/toast";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";

interface NotificationsTriggerProps {
  className?: string;
}

export const NotificationsTrigger = ({ className }: NotificationsTriggerProps) => {
  const notifications = useToastStore.use.notifications();
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
        <TabsList variant="segmented" className={cn(chromeControlGroup(), className)}>
          <Button
            onClick={() => {
              window.dispatchEvent(new CustomEvent(OPEN_NOTIFICATIONS_COMMAND_EVENT));
            }}
            type="button"
            variant="ghost"
            compact
            active={isCommandVisible}
            className={cn(
              chromeControl(),
              unreadCount > 0 && cn(chromeControl({ shape: "pill" }), "w-auto gap-1.5"),
            )}
            aria-label="Notifications"
          >
            <Bell className={chromeIcon()} weight="duotone" />
            {unreadCount > 0 && (
              <span className="ui-font ui-text-sm pointer-events-none font-medium tabular-nums text-current">
                {unreadCount}
              </span>
            )}
          </Button>
        </TabsList>
      </Tooltip>
      <NotificationsCommand
        isVisible={isCommandVisible}
        onClose={() => setIsCommandVisible(false)}
      />
    </>
  );
};
