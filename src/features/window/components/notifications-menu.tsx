import { Bell, Check, ChevronDown, ChevronUp, Info, AlertTriangle, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { Button } from "@/ui/button";
import { Dropdown } from "@/ui/dropdown";
import { useToastStore, type NotificationEntry } from "@/ui/toast";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";

interface NotificationsMenuProps {
  iconSize?: number;
  className?: string;
}

function getNotificationIcon(type: NotificationEntry["type"]) {
  switch (type) {
    case "success":
      return <Check className="size-3.5 text-success" />;
    case "warning":
      return <AlertTriangle className="size-3.5 text-warning" />;
    case "error":
      return <XCircle className="size-3.5 text-error" />;
    default:
      return <Info className="size-3.5 text-accent" />;
  }
}

function formatNotificationAge(timestamp: number) {
  const diffMs = Date.now() - timestamp;
  const diffMinutes = Math.floor(diffMs / 60000);

  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function NotificationItem({ notification }: { notification: NotificationEntry }) {
  const [expanded, setExpanded] = useState(false);
  const hasDescription = !!notification.description;

  return (
    <div
      className={cn(
        "mb-1 rounded-lg px-2.5 py-2 last:mb-0 hover:bg-hover/50",
        notification.read ? "bg-transparent" : "bg-hover/70",
        hasDescription && "cursor-pointer",
      )}
      onClick={hasDescription ? () => setExpanded((v) => !v) : undefined}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0">{getNotificationIcon(notification.type)}</span>
        <div className="min-w-0 flex-1">
          <div className="ui-font ui-text-sm break-words text-text">{notification.message}</div>
          {expanded && notification.description && (
            <pre className="ui-font ui-text-sm mt-1 whitespace-pre-wrap break-words text-text-light">
              {notification.description}
            </pre>
          )}
          <div className="ui-font ui-text-sm mt-1 flex items-center gap-1 text-text-lighter">
            <span>{formatNotificationAge(notification.updatedAt)}</span>
            {hasDescription &&
              (expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />)}
          </div>
        </div>
      </div>
    </div>
  );
}

export const NotificationsMenu = ({ iconSize = 14, className }: NotificationsMenuProps) => {
  const notifications = useToastStore.use.notifications();
  const markAllNotificationsRead = useToastStore((state) => state.actions.markAllNotificationsRead);
  const clearNotifications = useToastStore((state) => state.actions.clearNotifications);
  const hasBlockingModalOpen = useUIState(
    (state) =>
      state.isQuickOpenVisible ||
      state.isCommandPaletteVisible ||
      state.isGlobalSearchVisible ||
      state.isSettingsDialogVisible ||
      state.isThemeSelectorVisible ||
      state.isIconThemeSelectorVisible ||
      state.isProjectPickerVisible ||
      state.isDatabaseConnectionVisible,
  );

  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const unreadCount = useMemo(
    () =>
      notifications.filter((notification) => !notification.read && notification.type !== "success")
        .length,
    [notifications],
  );

  useEffect(() => {
    if (!isOpen || !hasBlockingModalOpen) return;
    setIsOpen(false);
  }, [hasBlockingModalOpen, isOpen]);

  useEffect(() => {
    if (!isOpen || unreadCount === 0) return;
    markAllNotificationsRead();
  }, [isOpen, unreadCount, markAllNotificationsRead]);

  return (
    <>
      <Tooltip content="Notifications" side="bottom">
        <div className="relative">
          <Button
            ref={buttonRef}
            onClick={() => setIsOpen((open) => !open)}
            type="button"
            variant="secondary"
            size="icon-sm"
            className={className}
            aria-expanded={isOpen}
            aria-haspopup="menu"
            aria-label="Notifications"
          >
            <Bell size={iconSize} />
          </Button>
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex min-w-[14px] items-center justify-center rounded-full bg-accent px-1 text-[10px] leading-4 text-primary-bg">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </div>
      </Tooltip>
      <Dropdown
        isOpen={isOpen}
        anchorRef={buttonRef}
        anchorAlign="end"
        className="w-[360px] max-w-[min(420px,calc(100vw-16px))]"
        onClose={() => setIsOpen(false)}
      >
        <div className="flex items-center justify-between px-3 py-2">
          <div className="ui-font ui-text-sm text-text">Notifications</div>
          {notifications.length > 0 && (
            <button
              type="button"
              className="ui-font ui-text-sm shrink-0 text-text-lighter hover:text-text"
              onClick={() => clearNotifications()}
            >
              Clear
            </button>
          )}
        </div>
        {notifications.length === 0 ? (
          <div className="ui-font ui-text-sm px-3 py-6 text-center text-text-lighter">
            No notifications yet.
          </div>
        ) : (
          <div className="max-h-[360px] overflow-y-auto p-1">
            {notifications.map((notification) => (
              <NotificationItem key={notification.id} notification={notification} />
            ))}
          </div>
        )}
      </Dropdown>
    </>
  );
};
