import {
  Bell,
  CaretRight,
  Check,
  ClipboardText,
  Copy,
  Funnel,
  Info,
  MagnifyingGlass as Search,
  Trash,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react";
import type React from "react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
import { Dropdown, type MenuItem } from "@/ui/dropdown";
import {
  SidebarEmptyState,
  SidebarHeader,
  SidebarHeaderIconButton,
  SidebarHeaderSearch,
} from "@/ui/sidebar";
import { TabsList } from "@/ui/tabs";
import { useToastStore, type NotificationEntry } from "@/ui/toast";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";

interface NotificationsMenuProps {
  className?: string;
}

type NotificationFilter = "all" | NotificationEntry["type"];

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

function formatNotificationGroupDate(timestamp: number) {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (left: Date, right: Date) =>
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate();

  if (sameDay(date, today)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

function NotificationHoverCard({
  children,
  notification,
}: {
  children: React.ReactNode;
  notification: NotificationEntry;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const cardWidth = 288;

  const left =
    rect && rect.right + 8 + cardWidth <= window.innerWidth
      ? rect.right + 8
      : Math.max(8, (rect?.left ?? 0) - cardWidth - 8);
  const top = rect ? Math.min(rect.top, window.innerHeight - 180) : 0;

  return (
    <div
      className="block min-w-0"
      onMouseEnter={(event) => setRect(event.currentTarget.getBoundingClientRect())}
      onMouseLeave={() => setRect(null)}
      onFocus={(event) => setRect(event.currentTarget.getBoundingClientRect())}
      onBlur={() => setRect(null)}
    >
      {children}
      {rect
        ? createPortal(
            <div
              className="pointer-events-none fixed z-[10060] rounded-xl border border-border bg-secondary-bg/95 p-2.5 shadow-lg backdrop-blur-sm"
              style={{ width: cardWidth, left, top }}
            >
              <div className="flex min-w-0 items-start gap-2">
                <span className="mt-0.5 shrink-0">{getNotificationIcon(notification.type)}</span>
                <div className="min-w-0 flex-1">
                  <div className="ui-font ui-text-sm break-words font-medium text-text">
                    {notification.message}
                  </div>
                  {notification.description ? (
                    <pre className="ui-font ui-text-xs mt-1 max-h-40 overflow-hidden whitespace-pre-wrap break-words text-text-light">
                      {notification.description}
                    </pre>
                  ) : null}
                  <div className="ui-font ui-text-xs mt-2 flex items-center gap-1 text-text-lighter">
                    <span className="capitalize">{notification.type}</span>
                    <span>-</span>
                    <span>{formatNotificationAge(notification.updatedAt)}</span>
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function NotificationItem({
  notification,
  onContextMenu,
  onDelete,
}: {
  notification: NotificationEntry;
  onContextMenu: (event: React.MouseEvent, notification: NotificationEntry) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <NotificationHoverCard notification={notification}>
      <div
        className="group relative mb-1 flex h-8 min-w-0 items-center gap-2 rounded-md px-2 last:mb-0 hover:bg-hover/50"
        onContextMenu={(event) => onContextMenu(event, notification)}
      >
        <span className="shrink-0">{getNotificationIcon(notification.type)}</span>
        <span className="ui-font ui-text-sm min-w-0 flex-1 truncate text-text group-hover:pr-7">
          {notification.message}
        </span>
        <Button
          type="button"
          variant="ghost"
          className="-translate-y-1/2 absolute top-1/2 right-1 size-6 rounded-md bg-primary-bg/90 p-0 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          tooltip="Delete Notification"
          tooltipSide="bottom"
          onClick={(event) => {
            event.stopPropagation();
            onDelete(notification.id);
          }}
        >
          <Trash />
        </Button>
      </div>
    </NotificationHoverCard>
  );
}

export function NotificationsPane() {
  const notifications = useToastStore.use.notifications();
  const markAllNotificationsRead = useToastStore((state) => state.actions.markAllNotificationsRead);
  const removeNotification = useToastStore((state) => state.actions.removeNotification);
  const clearNotifications = useToastStore((state) => state.actions.clearNotifications);
  const notificationContextMenu = useContextMenu<NotificationEntry>();
  const panelContextMenu = useContextMenu();
  const filterButtonRef = useRef<HTMLButtonElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [notificationFilter, setNotificationFilter] = useState<NotificationFilter>("all");
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);
  const [collapsedNotificationGroups, setCollapsedNotificationGroups] = useState<Set<string>>(
    () => new Set(),
  );
  const deferredSearchQuery = useDeferredValue(searchQuery);
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

  const copyText = async (text: string) => {
    await navigator.clipboard.writeText(text);
  };

  const notificationContextMenuItems = useMemo<ContextMenuItem[]>(() => {
    const notification = notificationContextMenu.data;
    if (!notification) return [];

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
      { id: "sep-delete", label: "", separator: true, onClick: () => {} },
      {
        id: "delete-notification",
        label: "Delete",
        icon: <Trash />,
        onClick: () => removeNotification(notification.id),
      },
      {
        id: "clear-all",
        label: "Clear All",
        icon: <Trash />,
        onClick: () => clearNotifications(),
      },
    ];
  }, [clearNotifications, notificationContextMenu.data, removeNotification]);

  const panelContextMenuItems = useMemo<ContextMenuItem[]>(
    () => [
      {
        id: "copy-all",
        label: "Copy All",
        icon: <ClipboardText />,
        disabled: notifications.length === 0,
        onClick: () => void copyText(notifications.map(formatNotificationText).join("\n\n---\n\n")),
      },
      {
        id: "clear-all",
        label: "Clear All",
        icon: <Trash />,
        disabled: notifications.length === 0,
        onClick: () => clearNotifications(),
      },
    ],
    [clearNotifications, notifications],
  );

  const filterMenuItems = useMemo<MenuItem[]>(
    () =>
      [
        { id: "all", label: "All", icon: <Funnel />, value: "all" },
        { id: "info", label: "Info", icon: <Info />, value: "info" },
        { id: "success", label: "Success", icon: <Check />, value: "success" },
        { id: "warning", label: "Warnings", icon: <WarningCircle />, value: "warning" },
        { id: "error", label: "Errors", icon: <XCircle />, value: "error" },
      ].map((item) => ({
        id: item.id,
        label: item.label,
        icon: item.icon,
        onClick: () => setNotificationFilter(item.value as NotificationFilter),
        className: notificationFilter === item.value ? "bg-hover text-text" : undefined,
      })),
    [notificationFilter],
  );

  const filteredNotifications = useMemo(() => {
    const query = deferredSearchQuery.trim().toLowerCase();
    const filterMatches = (notification: NotificationEntry) =>
      notificationFilter === "all" || notification.type === notificationFilter;
    const filteredByType = notifications.filter(filterMatches);
    if (!query) return filteredByType;

    return filteredByType.filter((notification) =>
      [
        notification.message,
        notification.description,
        notification.type,
        formatNotificationAge(notification.updatedAt),
      ]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(query)),
    );
  }, [deferredSearchQuery, notificationFilter, notifications]);

  const groupedNotifications = useMemo(() => {
    const groups: Array<{ label: string; notifications: NotificationEntry[] }> = [];

    for (const notification of filteredNotifications) {
      const label = formatNotificationGroupDate(notification.updatedAt);
      const lastGroup = groups[groups.length - 1];

      if (lastGroup?.label === label) {
        lastGroup.notifications.push(notification);
        continue;
      }

      groups.push({ label, notifications: [notification] });
    }

    return groups;
  }, [filteredNotifications]);

  const toggleNotificationGroup = (label: string) => {
    setCollapsedNotificationGroups((groups) => {
      const nextGroups = new Set(groups);
      if (nextGroups.has(label)) {
        nextGroups.delete(label);
      } else {
        nextGroups.add(label);
      }
      return nextGroups;
    });
  };

  return (
    <>
      <div
        className="flex h-full min-h-0 flex-col"
        onContextMenu={(event) => {
          if (notifications.length === 0) return;
          panelContextMenu.open(event);
        }}
      >
        {notifications.length > 0 ? (
          <SidebarHeader>
            <SidebarHeaderSearch
              value={searchQuery}
              onChange={setSearchQuery}
              leftIcon={Search}
              placeholder="Search"
            />
            <SidebarHeaderIconButton
              ref={filterButtonRef}
              active={notificationFilter !== "all"}
              className="shrink-0"
              tooltip="Filter Notifications"
              tooltipSide="bottom"
              onClick={() => setIsFilterMenuOpen(true)}
            >
              <Funnel />
            </SidebarHeaderIconButton>
          </SidebarHeader>
        ) : null}
        {notifications.length === 0 ? (
          <SidebarEmptyState>No notifications yet.</SidebarEmptyState>
        ) : filteredNotifications.length === 0 ? (
          <SidebarEmptyState>No matching notifications.</SidebarEmptyState>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto p-1">
            {groupedNotifications.map((group) => (
              <div key={group.label} className="mb-2 last:mb-0">
                <button
                  type="button"
                  className="ui-font ui-text-xs flex h-6 w-full items-center gap-1 rounded-md px-2 text-left text-text-lighter hover:bg-hover/50 hover:text-text"
                  aria-expanded={!collapsedNotificationGroups.has(group.label)}
                  onClick={() => toggleNotificationGroup(group.label)}
                >
                  <CaretRight
                    className={cn(
                      "size-3.5 shrink-0 transition-transform",
                      !collapsedNotificationGroups.has(group.label) && "rotate-90",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{group.label}</span>
                  <span className="shrink-0 rounded bg-hover/70 px-1.5 py-0.5">
                    {group.notifications.length}
                  </span>
                </button>
                {!collapsedNotificationGroups.has(group.label)
                  ? group.notifications.map((notification) => (
                      <NotificationItem
                        key={notification.id}
                        notification={notification}
                        onContextMenu={notificationContextMenu.open}
                        onDelete={removeNotification}
                      />
                    ))
                  : null}
              </div>
            ))}
          </div>
        )}
      </div>
      <ContextMenu
        isOpen={notificationContextMenu.isOpen}
        position={notificationContextMenu.position}
        items={notificationContextMenuItems}
        onClose={notificationContextMenu.close}
        className="w-fit min-w-fit"
      />
      <ContextMenu
        isOpen={panelContextMenu.isOpen}
        position={panelContextMenu.position}
        items={panelContextMenuItems}
        onClose={panelContextMenu.close}
        className="w-fit min-w-fit"
      />
      <Dropdown
        isOpen={isFilterMenuOpen}
        anchorRef={filterButtonRef}
        anchorSide="bottom"
        anchorAlign="end"
        items={filterMenuItems}
        onClose={() => setIsFilterMenuOpen(false)}
        className="w-fit min-w-fit"
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
