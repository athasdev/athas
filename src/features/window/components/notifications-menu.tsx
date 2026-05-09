import {
  Bell,
  Check,
  ClipboardText,
  Copy,
  Info,
  Trash,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import {
  CHROME_CONTROL_GROUP_CLASS_NAME,
  CHROME_ICON_CLASS_NAME,
  CHROME_ICON_BUTTON_CLASS_NAME,
  CHROME_PILL_BUTTON_CLASS_NAME,
} from "@/features/layout/components/chrome-control-styles";
import { resolveSidebarPaneClick } from "@/features/layout/utils/sidebar-pane-utils";
import { useSettingsStore } from "@/features/settings/store";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { Button } from "@/ui/button";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "@/ui/context-menu";
import { TabsList } from "@/ui/tabs";
import { useToastStore, type NotificationEntry } from "@/ui/toast";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";

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
          </div>
        </div>
      </div>
    </div>
  );
}

export function NotificationsPane() {
  const notifications = useToastStore.use.notifications();
  const markAllNotificationsRead = useToastStore((state) => state.actions.markAllNotificationsRead);
  const clearNotifications = useToastStore((state) => state.actions.clearNotifications);
  const notificationContextMenu = useContextMenu<NotificationEntry>();
  const unreadCount = useMemo(
    () =>
      notifications.filter((notification) => !notification.read && notification.type !== "success")
        .length,
    [notifications],
  );

  useEffect(() => {
    if (unreadCount === 0) return;
    markAllNotificationsRead();
  }, [unreadCount, markAllNotificationsRead]);

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
      <div className="flex h-full min-h-0 flex-col">
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
          <div className="min-h-0 flex-1 overflow-y-auto p-1">
            {notifications.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                onContextMenu={notificationContextMenu.open}
              />
            ))}
          </div>
        )}
      </div>
      <ContextMenu
        isOpen={notificationContextMenu.isOpen}
        position={notificationContextMenu.position}
        items={notificationContextMenuItems}
        onClose={notificationContextMenu.close}
      />
    </>
  );
}

export const NotificationsMenu = ({ className }: NotificationsMenuProps) => {
  const notifications = useToastStore.use.notifications();
  const {
    isSidebarVisible,
    isGitViewActive,
    isGitHubPRsViewActive,
    activeSidebarView,
    setActiveView,
    setIsSidebarVisible,
  } = useUIState();
  const { settings, updateSetting } = useSettingsStore();
  const unreadCount = useMemo(
    () =>
      notifications.filter((notification) => !notification.read && notification.type !== "success")
        .length,
    [notifications],
  );
  const isActive = isSidebarVisible && activeSidebarView === "notifications";

  return (
    <Tooltip content="Notifications" side="top">
      <TabsList variant="segmented" className={cn(CHROME_CONTROL_GROUP_CLASS_NAME, className)}>
        <Button
          onClick={() => {
            if (settings.sidebarPosition !== "right") {
              void updateSetting("sidebarPosition", "right");
            }
            const { nextIsSidebarVisible, nextView } = resolveSidebarPaneClick(
              {
                isSidebarVisible,
                isGitViewActive,
                isGitHubPRsViewActive,
                activeSidebarView,
              },
              "notifications",
            );
            setActiveView(nextView);
            setIsSidebarVisible(nextIsSidebarVisible);
          }}
          type="button"
          variant="ghost"
          compact
          active={isActive}
          className={cn(
            CHROME_ICON_BUTTON_CLASS_NAME,
            unreadCount > 0 && cn(CHROME_PILL_BUTTON_CLASS_NAME, "w-auto gap-1.5"),
          )}
          aria-label="Notifications"
        >
          <Bell className={CHROME_ICON_CLASS_NAME} weight="duotone" />
          {unreadCount > 0 && (
            <span className="ui-font ui-text-sm pointer-events-none font-medium tabular-nums text-current">
              {unreadCount}
            </span>
          )}
        </Button>
      </TabsList>
    </Tooltip>
  );
};
