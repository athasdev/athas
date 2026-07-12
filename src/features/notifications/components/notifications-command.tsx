import {
  CaretRightIcon as CaretRight,
  CheckIcon as Check,
  ClipboardTextIcon as ClipboardText,
  CopyIcon as Copy,
  FunnelIcon as Funnel,
  InfoIcon as Info,
  MagnifyingGlassIcon as Search,
  TrashIcon as Trash,
  WarningCircleIcon as WarningCircle,
  XCircleIcon as XCircle,
} from "@/ui/icons";
import type React from "react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { NotificationIcon } from "@/features/notifications/components/notification-icon";
import { NotificationListItem } from "@/features/notifications/components/notification-list-item";
import type { NotificationFilter } from "@/features/notifications/types/notifications.types";
import {
  formatNotificationAge,
  formatNotificationGroupDate,
  formatNotificationText,
} from "@/features/notifications/utils/notification-formatters";
import { Button } from "@/ui/button";
import Command, {
  CommandEmpty,
  CommandHeader,
  CommandHeaderAction,
  CommandInput,
  CommandItemBadge,
  CommandList,
} from "@/ui/command";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "@/ui/context-menu";
import { Dropdown, type MenuItem } from "@/ui/dropdown";
import { ItemGroup } from "@/ui/item";
import { useToastStore, type NotificationEntry } from "@/ui/toast";
import Tooltip from "@/ui/tooltip";
import { writeClipboardText } from "@/utils/clipboard";
import { cn } from "@/utils/cn";

interface NotificationsCommandProps {
  isVisible: boolean;
  onClose: () => void;
}

export function NotificationsCommand({ isVisible, onClose }: NotificationsCommandProps) {
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
    if (!isVisible || unreadCount === 0) return;
    markAllNotificationsRead();
  }, [isVisible, unreadCount, markAllNotificationsRead]);

  useEffect(() => {
    if (!isVisible) return;
    focusNotificationSearch();
  }, [isVisible]);

  const copyText = async (text: string) => {
    await writeClipboardText(text);
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
      <Command isVisible={isVisible} onClose={onClose} title="Notifications">
        <div
          className="flex h-full min-h-0 flex-col"
          onKeyDownCapture={handleNotificationsKeyDown}
          onContextMenu={(event) => {
            if (notifications.length === 0) return;
            panelContextMenu.open(event);
          }}
        >
          <CommandHeader onClose={onClose}>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <Search className="size-3.5 shrink-0 text-text-lighter" />
              <CommandInput
                ref={searchInputRef}
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search notifications"
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" && visibleNotifications.length > 0) {
                    event.preventDefault();
                    focusNotificationAtIndex(0);
                  }
                }}
              />
            </div>
            <Tooltip content="Filter Notifications" side="bottom" triggerClassName="size-7">
              <CommandHeaderAction
                ref={filterButtonRef}
                type="button"
                active={notificationFilter !== "all"}
                aria-label="Filter Notifications"
                onClick={() => setIsFilterMenuOpen(true)}
              >
                <Funnel />
              </CommandHeaderAction>
            </Tooltip>
          </CommandHeader>
          {notifications.length === 0 ? (
            <CommandEmpty>No notifications yet.</CommandEmpty>
          ) : filteredNotifications.length === 0 ? (
            <CommandEmpty>No matching notifications.</CommandEmpty>
          ) : (
            <CommandList>
              <div className="flex min-h-0 flex-1 flex-col gap-1.5">
                {groupedNotifications.map((group) => (
                  <div key={group.label} className="flex flex-col gap-1">
                    <button
                      type="button"
                      className="ui-font ui-text-base flex h-6 w-full select-none items-center gap-1 rounded-[var(--app-radius-menu-item)] px-2 text-left text-text-lighter transition-colors hover:bg-hover/50 hover:text-text"
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
                      <CommandItemBadge>{group.notifications.length}</CommandItemBadge>
                    </button>
                    {!collapsedNotificationGroups.has(group.label) ? (
                      <ItemGroup className="gap-0.5">
                        {group.notifications.map((notification) => (
                          <NotificationListItem
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
                            onKeyDown={(event) =>
                              handleNotificationItemKeyDown(event, notification)
                            }
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
            </CommandList>
          )}
        </div>
      </Command>
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
        className="z-[10070] w-fit min-w-fit"
      />
      <Command
        isVisible={activeNotification !== null}
        onClose={() => {
          setActiveNotification(null);
          setCopiedNotificationId(null);
        }}
        title="Notification details"
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
                <span className="shrink-0">
                  <NotificationIcon type={activeNotification.type} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="ui-font ui-text-base truncate font-medium text-text">
                    {activeNotification.message}
                  </div>
                  <div className="ui-font ui-text-base mt-0.5 flex items-center gap-1 text-text-lighter">
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
                  <pre className="ui-font ui-text-base max-h-40 overflow-auto whitespace-pre-wrap break-words text-text-light">
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
