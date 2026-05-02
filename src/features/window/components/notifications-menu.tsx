import {
  Bell,
  CaretDown,
  CaretUp,
  Check,
  ClipboardText,
  Copy,
  Info,
  Trash,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { Button } from "@/ui/button";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "@/ui/context-menu";
import { Dropdown } from "@/ui/dropdown";
import { TabsList } from "@/ui/tabs";
import { useToastStore, type NotificationEntry } from "@/ui/toast";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";

const TITLE_BAR_CONTROL_GROUP_CLASS_NAME =
  "pointer-events-auto border-transparent bg-transparent p-0";
const TITLE_BAR_ICON_BUTTON_CLASS_NAME =
  "h-6 rounded-md border-0 bg-transparent text-text-lighter hover:bg-hover/60 hover:text-text focus-visible:rounded-md data-[active=true]:bg-hover/70";

interface NotificationsMenuProps {
  className?: string;
}

function getNotificationIcon(type: NotificationEntry["type"]) {
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

function formatNotificationText(notification: NotificationEntry) {
  return [
    notification.message,
    notification.description,
    `${notification.type} - ${formatNotificationAge(notification.updatedAt)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function NotificationItem({
  notification,
  onContextMenu,
}: {
  notification: NotificationEntry;
  onContextMenu: (event: React.MouseEvent, notification: NotificationEntry) => void;
}) {
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
      onContextMenu={(event) => onContextMenu(event, notification)}
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
              (expanded ? (
                <CaretUp className="size-3" weight="bold" />
              ) : (
                <CaretDown className="size-3" weight="bold" />
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export const NotificationsMenu = ({ className }: NotificationsMenuProps) => {
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
  const notificationContextMenu = useContextMenu<NotificationEntry>();
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

  const notificationContextMenuItems = useMemo<ContextMenuItem[]>(() => {
    const notification = notificationContextMenu.data;
    if (!notification) return [];

    const copyText = async (text: string) => {
      await navigator.clipboard.writeText(text);
    };

    return [
      {
        id: "copy-message",
        label: "Copy Message",
        icon: <Copy />,
        onClick: () => void copyText(notification.message),
      },
      ...(notification.description
        ? [
            {
              id: "copy-details",
              label: "Copy Details",
              icon: <ClipboardText />,
              onClick: () => void copyText(notification.description || ""),
            },
          ]
        : []),
      {
        id: "copy-notification",
        label: "Copy Notification",
        icon: <ClipboardText />,
        onClick: () => void copyText(formatNotificationText(notification)),
      },
      { id: "sep-clear", label: "", separator: true, onClick: () => {} },
      {
        id: "clear-all",
        label: "Clear All",
        icon: <Trash />,
        onClick: () => clearNotifications(),
      },
    ];
  }, [clearNotifications, notificationContextMenu.data]);

  return (
    <>
      <Tooltip content="Notifications" side="bottom">
        <TabsList variant="segmented" className={cn(TITLE_BAR_CONTROL_GROUP_CLASS_NAME, className)}>
          <Button
            ref={buttonRef}
            onClick={() => setIsOpen((open) => !open)}
            type="button"
            variant="ghost"
            size="sm"
            active={isOpen}
            className={cn(
              TITLE_BAR_ICON_BUTTON_CLASS_NAME,
              unreadCount > 0 ? "min-w-10 gap-1 px-1.5" : "w-7 px-0",
            )}
            aria-expanded={isOpen}
            aria-haspopup="menu"
            aria-label="Notifications"
          >
            <Bell className="size-4" weight="duotone" />
            {unreadCount > 0 && (
              <span className="ui-font ui-text-sm pointer-events-none font-medium tabular-nums text-current">
                {unreadCount}
              </span>
            )}
          </Button>
        </TabsList>
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
              <NotificationItem
                key={notification.id}
                notification={notification}
                onContextMenu={notificationContextMenu.open}
              />
            ))}
          </div>
        )}
      </Dropdown>
      <ContextMenu
        isOpen={notificationContextMenu.isOpen}
        position={notificationContextMenu.position}
        items={notificationContextMenuItems}
        onClose={notificationContextMenu.close}
      />
    </>
  );
};
