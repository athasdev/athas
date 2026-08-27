import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { GitHubAuthStatusMessage } from "@/features/github/components/github-auth-status";
import type { useGitHubNotifications } from "@/features/notifications/hooks/use-github-notifications";
import { NotificationIcon } from "@/features/notifications/components/notification-icon";
import { useNotificationsStore } from "@/features/notifications/stores/notifications.store";
import type {
  NotificationCategory,
  NotificationCategoryFilter,
  NotificationEntry,
} from "@/features/notifications/types/notifications.types";
import {
  formatNotificationAge,
  formatNotificationText,
} from "@/features/notifications/utils/notification-formatters";
import { getTimeAgo } from "@/features/github/utils/github-viewer-utils";
import { Button } from "@/ui/button";
import Command, {
  CommandEmpty,
  CommandHeader,
  CommandHeaderAction,
  CommandInput,
  CommandItemAction,
  CommandItemBadge,
  CommandItemRow,
  CommandList,
  CommandTabs,
} from "@/ui/command";
import {
  BellIcon,
  ChatCircleTextIcon,
  CopyIcon,
  GitPullRequestIcon,
  GithubLogoIcon,
  LightningIcon,
  MagnifyingGlassIcon,
  SparkleIcon,
  TrashIcon,
} from "@/ui/icons";
import { writeClipboardText } from "@/utils/clipboard";
import { matchesSearchQuery } from "@/utils/search-match";

type GitHubNotificationsModel = ReturnType<typeof useGitHubNotifications>;

interface NotificationsCommandProps {
  isVisible: boolean;
  initialCategory: NotificationCategoryFilter;
  github: GitHubNotificationsModel;
  onClose: () => void;
}

interface LocalNotificationSection {
  id: NotificationCategory;
  label: string;
  notifications: NotificationEntry[];
}

function notificationReasonLabel(reason: string) {
  if (reason === "ci_activity") return "Workflow completed";
  const label = reason.replace(/_/g, " ");
  return label ? `${label[0]?.toUpperCase()}${label.slice(1)}` : "";
}

function GitHubNotificationIcon({ subjectType }: { subjectType: string }) {
  if (subjectType === "PullRequest") return <GitPullRequestIcon />;
  if (subjectType === "Issue") return <ChatCircleTextIcon />;
  if (subjectType === "CheckSuite") return <LightningIcon />;
  return <GithubLogoIcon />;
}

export function NotificationsCommand({
  isVisible,
  initialCategory,
  github,
  onClose,
}: NotificationsCommandProps) {
  const notifications = useNotificationsStore.use.notifications();
  const markAllNotificationsRead = useNotificationsStore.use.actions().markAllRead;
  const removeNotification = useNotificationsStore.use.actions().remove;
  const clearNotifications = useNotificationsStore.use.actions().clear;
  const [category, setCategory] = useState<NotificationCategoryFilter>(initialCategory);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeNotification, setActiveNotification] = useState<NotificationEntry | null>(null);
  const [copiedNotificationId, setCopiedNotificationId] = useState<string | null>(null);
  const deferredSearchQuery = useDeferredValue(searchQuery);

  useEffect(() => {
    if (!isVisible) return;
    setCategory(initialCategory);
    markAllNotificationsRead();
    if (github.isAuthenticated) void github.refresh();
  }, [
    github.isAuthenticated,
    github.refresh,
    initialCategory,
    isVisible,
    markAllNotificationsRead,
  ]);

  const localSections = useMemo<LocalNotificationSection[]>(() => {
    const sections: LocalNotificationSection[] = [
      { id: "athas", label: "Athas", notifications: [] },
      { id: "agent", label: "Agent", notifications: [] },
    ];

    for (const notification of notifications) {
      const notificationCategory = notification.category ?? "athas";
      if (category !== "all" && category !== notificationCategory) continue;
      if (
        !matchesSearchQuery(deferredSearchQuery, [
          notification.message,
          notification.description,
          notification.type,
          notification.category,
          formatNotificationAge(notification.updatedAt),
        ])
      ) {
        continue;
      }
      sections
        .find((section) => section.id === notificationCategory)
        ?.notifications.push(notification);
    }

    return sections.filter((section) => section.notifications.length > 0);
  }, [category, deferredSearchQuery, notifications]);

  const githubNotifications = useMemo(() => {
    if (category !== "all" && category !== "github") return [];
    return github.notifications.filter((notification) =>
      matchesSearchQuery(deferredSearchQuery, [
        notification.title,
        notification.repositoryFullName,
        notification.reason,
        notification.subjectType,
      ]),
    );
  }, [category, deferredSearchQuery, github.notifications]);

  const hasVisibleNotifications = localSections.length > 0 || githubNotifications.length > 0;
  const selectedCategoryCount =
    (category === "all" || category === "athas"
      ? notifications.filter((notification) => (notification.category ?? "athas") === "athas")
          .length
      : 0) +
    (category === "all" || category === "agent"
      ? notifications.filter((notification) => notification.category === "agent").length
      : 0) +
    (category === "all" || category === "github" ? github.notifications.length : 0);

  const copyActiveNotification = async (notification: NotificationEntry) => {
    await writeClipboardText(formatNotificationText(notification));
    setCopiedNotificationId(notification.id);
    window.setTimeout(() => {
      setCopiedNotificationId((currentId) => (currentId === notification.id ? null : currentId));
    }, 1000);
  };

  const closeDetails = () => {
    setActiveNotification(null);
    setCopiedNotificationId(null);
  };

  return (
    <>
      <Command isVisible={isVisible} onClose={onClose} title="Notifications">
        <CommandHeader onClose={onClose}>
          <MagnifyingGlassIcon className="shrink-0 text-subtle-foreground" />
          <CommandInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search notifications"
            aria-label="Search notifications"
          />
          {notifications.length > 0 ? (
            <CommandHeaderAction
              aria-label="Clear local notifications"
              onClick={clearNotifications}
            >
              <TrashIcon />
            </CommandHeaderAction>
          ) : null}
        </CommandHeader>
        <CommandTabs
          ariaLabel="Notification categories"
          items={[
            {
              id: "all",
              label: "All",
              isActive: category === "all",
              onSelect: () => setCategory("all"),
            },
            {
              id: "athas",
              label: "Athas",
              icon: <BellIcon />,
              isActive: category === "athas",
              onSelect: () => setCategory("athas"),
            },
            {
              id: "agent",
              label: "Agent",
              icon: <SparkleIcon />,
              isActive: category === "agent",
              onSelect: () => setCategory("agent"),
            },
            {
              id: "github",
              label: "GitHub",
              icon: <GithubLogoIcon />,
              isActive: category === "github",
              onSelect: () => setCategory("github"),
            },
          ]}
        />
        {!github.isAuthenticated && category === "github" ? (
          <GitHubAuthStatusMessage />
        ) : github.error && category === "github" ? (
          <CommandEmpty>
            <div className="flex flex-col items-center gap-2">
              <span>Could not load GitHub notifications.</span>
              <Button type="button" variant="ghost" onClick={() => void github.refresh(true)}>
                Try again
              </Button>
            </div>
          </CommandEmpty>
        ) : github.isLoading &&
          (category === "all" || category === "github") &&
          selectedCategoryCount === 0 ? (
          <CommandEmpty>Loading notifications…</CommandEmpty>
        ) : !hasVisibleNotifications ? (
          <CommandEmpty>
            {deferredSearchQuery ? "No matching notifications." : "No notifications yet."}
          </CommandEmpty>
        ) : (
          <CommandList>
            <div className="flex flex-col gap-2">
              {localSections.map((section) => (
                <section key={section.id} aria-labelledby={`notification-section-${section.id}`}>
                  <div className="flex h-7 items-center gap-2 px-2 text-subtle-foreground ui-text-sm">
                    <span id={`notification-section-${section.id}`} className="min-w-0 flex-1">
                      {section.label}
                    </span>
                    <CommandItemBadge>{section.notifications.length}</CommandItemBadge>
                  </div>
                  {section.notifications.map((notification) => (
                    <CommandItemRow
                      key={notification.id}
                      as="div"
                      icon={<NotificationIcon type={notification.type} />}
                      title={notification.message}
                      description={
                        notification.description ?? formatNotificationAge(notification.updatedAt)
                      }
                      contentLayout="stacked"
                      onClick={() => setActiveNotification(notification)}
                      action={
                        <CommandItemAction
                          tone="danger"
                          aria-label={`Delete ${notification.message}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            removeNotification(notification.id);
                          }}
                        >
                          <TrashIcon />
                        </CommandItemAction>
                      }
                    />
                  ))}
                </section>
              ))}
              {githubNotifications.length > 0 ? (
                <section aria-labelledby="notification-section-github">
                  <div className="flex h-7 items-center gap-2 px-2 text-subtle-foreground ui-text-sm">
                    <span id="notification-section-github" className="min-w-0 flex-1">
                      GitHub
                    </span>
                    <CommandItemBadge>{githubNotifications.length}</CommandItemBadge>
                  </div>
                  {githubNotifications.map((notification) => (
                    <CommandItemRow
                      key={notification.id}
                      icon={<GitHubNotificationIcon subjectType={notification.subjectType} />}
                      title={notification.title}
                      description={`${notification.repositoryFullName} · ${notificationReasonLabel(notification.reason)} · ${getTimeAgo(notification.updatedAt, { includeAgo: false })}`}
                      contentLayout="stacked"
                      onClick={() => {
                        onClose();
                        github.openNotification(notification);
                      }}
                    />
                  ))}
                </section>
              ) : null}
            </div>
          </CommandList>
        )}
      </Command>
      <Command
        isVisible={activeNotification !== null}
        onClose={closeDetails}
        title="Notification details"
      >
        {activeNotification ? (
          <>
            <CommandHeader onClose={closeDetails}>
              <NotificationIcon type={activeNotification.type} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-foreground ui-text-sm">
                  {activeNotification.message}
                </div>
                <div className="mt-0.5 flex items-center gap-1 text-subtle-foreground ui-text-sm">
                  <span className="capitalize">{activeNotification.category ?? "athas"}</span>
                  <span>·</span>
                  <span>{formatNotificationAge(activeNotification.updatedAt)}</span>
                </div>
              </div>
            </CommandHeader>
            <CommandList>
              {activeNotification.description ? (
                <pre className="font-sans max-h-40 whitespace-pre-wrap wrap-break-word rounded-chrome bg-surface/55 p-2 text-muted-foreground ui-text-sm">
                  {activeNotification.description}
                </pre>
              ) : null}
              <div className="mt-2 flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void copyActiveNotification(activeNotification)}
                >
                  <CopyIcon />
                  {copiedNotificationId === activeNotification.id ? "Copied" : "Copy"}
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => {
                    removeNotification(activeNotification.id);
                    closeDetails();
                  }}
                >
                  <TrashIcon />
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
