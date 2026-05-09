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
import { forwardRef, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
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
import Command, { CommandHeader, CommandList } from "@/ui/command";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "@/ui/context-menu";
import { Dropdown, type MenuItem } from "@/ui/dropdown";
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia, ItemTitle } from "@/ui/item";
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

interface NotificationsTriggerProps {
  className?: string;
}

type NotificationFilter = "all" | NotificationEntry["type"];
type NotificationItemAction = {
  id: string;
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
  variant?: "default" | "danger";
};

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

const NotificationItem = forwardRef<
  HTMLDivElement,
  {
    notification: NotificationEntry;
    actions: NotificationItemAction[];
    onContextMenu: (event: React.MouseEvent, notification: NotificationEntry) => void;
    selected?: boolean;
    tabIndex?: number;
    onClick?: () => void;
    onFocus?: () => void;
    onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  }
>(function NotificationItem(
  { notification, actions, onContextMenu, selected = false, tabIndex, onClick, onFocus, onKeyDown },
  ref,
) {
  return (
    <Item
      ref={ref}
      role="button"
      tabIndex={tabIndex}
      size="xs"
      variant={selected ? "muted" : "default"}
      className="relative h-7 flex-nowrap select-none rounded-md px-2 py-0 hover:bg-hover/45 focus-visible:bg-hover/45 focus-visible:ring-0"
      onClick={onClick}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => onContextMenu(event, notification)}
    >
      <ItemMedia variant="icon">{getNotificationIcon(notification.type)}</ItemMedia>
      <ItemContent className="min-w-0 overflow-hidden group-hover/item:pr-7 group-focus-within/item:pr-7">
        <ItemTitle className="ui-font ui-text-sm block w-full min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-normal text-text">
          {notification.message}
        </ItemTitle>
      </ItemContent>
      <ItemActions className="pointer-events-none absolute top-1/2 right-1 -translate-y-1/2 gap-1 opacity-0 transition-opacity group-hover/item:pointer-events-auto group-hover/item:opacity-100 group-focus-within/item:pointer-events-auto group-focus-within/item:opacity-100">
        {actions.map((action) => (
          <Tooltip key={action.id} content={action.label} side="bottom" triggerClassName="size-6">
            <Button
              type="button"
              variant="ghost"
              compact
              className={cn(
                "size-5 min-w-5 rounded bg-transparent p-0 text-text-lighter hover:bg-hover hover:text-text",
                action.variant === "danger" && "hover:text-error",
              )}
              onClick={(event) => {
                event.stopPropagation();
                action.onSelect();
              }}
              onKeyDown={(event) => event.stopPropagation()}
            >
              {action.icon}
            </Button>
          </Tooltip>
        ))}
      </ItemActions>
    </Item>
  );
});

export function NotificationsPane() {
  const notifications = useToastStore.use.notifications();
  const markAllNotificationsRead = useToastStore((state) => state.actions.markAllNotificationsRead);
  const removeNotification = useToastStore((state) => state.actions.removeNotification);
  const clearNotifications = useToastStore((state) => state.actions.clearNotifications);
  const notificationContextMenu = useContextMenu<NotificationEntry>();
  const panelContextMenu = useContextMenu();
  const filterButtonRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const notificationRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [searchQuery, setSearchQuery] = useState("");
  const [focusedNotificationId, setFocusedNotificationId] = useState<string | null>(null);
  const [activeNotification, setActiveNotification] = useState<NotificationEntry | null>(null);
  const [copiedNotificationId, setCopiedNotificationId] = useState<string | null>(null);
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

  const openNotificationDetails = (notification: NotificationEntry) => {
    setFocusedNotificationId(notification.id);
    setCopiedNotificationId(null);
    setActiveNotification(notification);
  };

  const copyActiveNotification = async (notification: NotificationEntry) => {
    await copyText(formatNotificationText(notification));
    setCopiedNotificationId(notification.id);
    window.setTimeout(() => {
      setCopiedNotificationId((currentId) => (currentId === notification.id ? null : currentId));
    }, 1000);
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
  const visibleNotifications = useMemo(
    () =>
      groupedNotifications.flatMap((group) =>
        collapsedNotificationGroups.has(group.label) ? [] : group.notifications,
      ),
    [collapsedNotificationGroups, groupedNotifications],
  );
  const focusedNotificationIndex = focusedNotificationId
    ? visibleNotifications.findIndex((notification) => notification.id === focusedNotificationId)
    : -1;

  useEffect(() => {
    if (visibleNotifications.length === 0) {
      setFocusedNotificationId(null);
      return;
    }

    if (
      !focusedNotificationId ||
      !visibleNotifications.some((notification) => notification.id === focusedNotificationId)
    ) {
      setFocusedNotificationId(visibleNotifications[0]?.id ?? null);
    }
  }, [focusedNotificationId, visibleNotifications]);

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

  const focusNotificationAtIndex = (index: number) => {
    const notification = visibleNotifications[index];
    if (!notification) return;

    setFocusedNotificationId(notification.id);
    requestAnimationFrame(() => notificationRefs.current.get(notification.id)?.focus());
  };

  const focusNotificationSearch = () => {
    if (notifications.length === 0) return;
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  };

  const handleNotificationsKeyDown = (event: React.KeyboardEvent) => {
    const target = event.target;
    const isTypingTarget =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable);

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      focusNotificationSearch();
      return;
    }

    if (!isTypingTarget && event.key === "/") {
      event.preventDefault();
      focusNotificationSearch();
    }
  };

  const handleNotificationItemKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
    notification: NotificationEntry,
  ) => {
    const currentIndex = visibleNotifications.findIndex((item) => item.id === notification.id);
    if (currentIndex === -1) return;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusNotificationAtIndex(Math.min(currentIndex + 1, visibleNotifications.length - 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        focusNotificationAtIndex(Math.max(currentIndex - 1, 0));
        break;
      case "Home":
        event.preventDefault();
        focusNotificationAtIndex(0);
        break;
      case "End":
        event.preventDefault();
        focusNotificationAtIndex(visibleNotifications.length - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        openNotificationDetails(notification);
        break;
      case "Delete":
      case "Backspace":
        event.preventDefault();
        removeNotification(notification.id);
        break;
    }
  };

  return (
    <>
      <div
        className="flex h-full min-h-0 flex-col"
        onKeyDownCapture={handleNotificationsKeyDown}
        onContextMenu={(event) => {
          if (notifications.length === 0) return;
          panelContextMenu.open(event);
        }}
      >
        {notifications.length > 0 ? (
          <SidebarHeader>
            <SidebarHeaderSearch
              ref={searchInputRef}
              value={searchQuery}
              onChange={setSearchQuery}
              leftIcon={Search}
              placeholder="Search"
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" && visibleNotifications.length > 0) {
                  event.preventDefault();
                  focusNotificationAtIndex(0);
                }
              }}
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
          <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-1">
            {groupedNotifications.map((group) => (
              <div key={group.label} className="flex flex-col gap-1">
                <button
                  type="button"
                  className="ui-font ui-text-xs flex h-6 w-full select-none items-center gap-1 rounded-md px-2 text-left text-text-lighter hover:bg-hover/50 hover:text-text"
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
                {!collapsedNotificationGroups.has(group.label) ? (
                  <ItemGroup className="gap-0.5">
                    {group.notifications.map((notification) => (
                      <NotificationItem
                        key={notification.id}
                        ref={(node) => {
                          if (node) {
                            notificationRefs.current.set(notification.id, node);
                          } else {
                            notificationRefs.current.delete(notification.id);
                          }
                        }}
                        notification={notification}
                        actions={[
                          {
                            id: "delete-notification",
                            label: "Delete Notification",
                            icon: <Trash className="size-3.5" />,
                            onSelect: () => removeNotification(notification.id),
                            variant: "danger",
                          },
                        ]}
                        selected={notification.id === focusedNotificationId}
                        onClick={() => openNotificationDetails(notification)}
                        onContextMenu={notificationContextMenu.open}
                        onFocus={() => setFocusedNotificationId(notification.id)}
                        onKeyDown={(event) => handleNotificationItemKeyDown(event, notification)}
                        tabIndex={
                          notification.id === focusedNotificationId ||
                          (focusedNotificationIndex === -1 &&
                            notification === visibleNotifications[0])
                            ? 0
                            : -1
                        }
                      />
                    ))}
                  </ItemGroup>
                ) : null}
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
      <Command
        isVisible={activeNotification !== null}
        onClose={() => {
          setActiveNotification(null);
          setCopiedNotificationId(null);
        }}
        title="Notification details"
        className="w-[520px]"
      >
        {activeNotification ? (
          <>
            <CommandHeader
              onClose={() => {
                setActiveNotification(null);
                setCopiedNotificationId(null);
              }}
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="shrink-0">{getNotificationIcon(activeNotification.type)}</span>
                <div className="min-w-0 flex-1">
                  <div className="ui-font ui-text-sm truncate font-medium text-text">
                    {activeNotification.message}
                  </div>
                  <div className="ui-font ui-text-xs mt-0.5 flex items-center gap-1 text-text-lighter">
                    <span className="capitalize">{activeNotification.type}</span>
                    <span>-</span>
                    <span>{formatNotificationAge(activeNotification.updatedAt)}</span>
                  </div>
                </div>
              </div>
            </CommandHeader>
            <CommandList>
              {activeNotification.description ? (
                <div className="border-border/70 border-b px-3 py-2">
                  <pre className="ui-font ui-text-xs max-h-40 overflow-auto whitespace-pre-wrap break-words text-text-light">
                    {activeNotification.description}
                  </pre>
                </div>
              ) : null}
              <div className="flex items-center gap-2 p-2">
                <Button
                  type="button"
                  variant="ghost"
                  compact
                  className="gap-1.5"
                  onClick={() => void copyActiveNotification(activeNotification)}
                >
                  <Copy className="size-3.5" />
                  {copiedNotificationId === activeNotification.id ? "Copied" : "Copy"}
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  compact
                  className="gap-1.5"
                  onClick={() => {
                    removeNotification(activeNotification.id);
                    setActiveNotification(null);
                  }}
                >
                  <Trash className="size-3.5" />
                  Delete
                </Button>
              </div>
            </CommandList>
          </>
        ) : null}
      </Command>
    </>
  );
}

export const NotificationsTrigger = ({ className }: NotificationsTriggerProps) => {
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
