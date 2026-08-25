import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { menuLabelVariants } from "@/design-system/menu";
import { Button } from "@/ui/button";
import { Dropdown } from "@/ui/dropdown";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyState,
  EmptyTitle,
} from "@/ui/empty";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/ui/item";
import {
  BellIcon as Bell,
  ChatCircleTextIcon as MessageSquare,
  GitPullRequestIcon as GitPullRequest,
  LightningIcon as Lightning,
} from "@/ui/icons";
import { Spinner } from "@/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/ui/tabs";
import Tooltip from "@/ui/tooltip";
import { useGitHubStore } from "../stores/github.store";
import type { GitHubNotification } from "../types/github.types";
import {
  GITHUB_NOTIFICATION_LIST_TTL_MS,
  githubNotificationListCache,
} from "../utils/github-data-cache";
import { getGitHubNotificationTarget } from "../utils/github-notification-routing";
import {
  filterGitHubNotifications,
  GITHUB_NOTIFICATION_PAGE_SIZE,
  groupGitHubNotificationsByDate,
  type GitHubNotificationFilter,
} from "../utils/github-notification-list";
import { getTimeAgo } from "../utils/github-viewer-utils";
import { GitHubAuthStatusMessage } from "./github-auth-status";

function notificationReasonLabel(reason: string): string {
  if (reason === "ci_activity") return "Workflow completed";
  const label = reason.replace(/_/g, " ");
  return label ? `${label[0].toUpperCase()}${label.slice(1)}` : "";
}

function NotificationIcon({ subjectType }: { subjectType: string }) {
  if (subjectType === "PullRequest") return <GitPullRequest className="size-4 text-primary" />;
  if (subjectType === "Issue") return <MessageSquare className="size-4 text-success" />;
  if (subjectType === "CheckSuite") return <Lightning className="size-4 text-warning" />;
  return <Bell className="size-4 text-primary" />;
}

export function GitHubNotificationsMenu() {
  const isAuthenticated = useGitHubStore.use.isAuthenticated();
  const { checkAuth } = useGitHubStore.use.actions();
  const { openPRBuffer, openGitHubIssueBuffer, openGitHubActionBuffer } =
    useBufferStore.use.actions();
  const hasBlockingModalOpen = useUIState(
    (state) =>
      state.isQuickOpenVisible ||
      state.isCommandPaletteVisible ||
      state.isGlobalSearchVisible ||
      state.isSettingsDialogVisible ||
      state.isProjectPickerVisible ||
      state.isDatabaseConnectionVisible,
  );
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<GitHubNotification[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<GitHubNotificationFilter>("all");
  const [visibleCount, setVisibleCount] = useState(GITHUB_NOTIFICATION_PAGE_SIZE);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const filteredNotifications = useMemo(
    () => filterGitHubNotifications(notifications, filter),
    [filter, notifications],
  );
  const visibleNotifications = useMemo(
    () => filteredNotifications.slice(0, visibleCount),
    [filteredNotifications, visibleCount],
  );
  const notificationGroups = useMemo(
    () => groupGitHubNotificationsByDate(visibleNotifications),
    [visibleNotifications],
  );

  const fetchNotifications = useCallback(async (force = false) => {
    const cacheKey = "unread";
    const cached = githubNotificationListCache.getFreshValue(
      cacheKey,
      GITHUB_NOTIFICATION_LIST_TTL_MS,
    );
    if (cached && !force) {
      setNotifications(cached);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const nextNotifications = await githubNotificationListCache.load(
        cacheKey,
        () => invoke<GitHubNotification[]>("github_list_notifications"),
        { force, ttlMs: GITHUB_NOTIFICATION_LIST_TTL_MS },
      );
      setNotifications(nextNotifications);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (!isAuthenticated) return;

    void fetchNotifications();
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") void fetchNotifications(true);
    }, GITHUB_NOTIFICATION_LIST_TTL_MS);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void fetchNotifications();
    };

    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [fetchNotifications, isAuthenticated]);

  useEffect(() => {
    if (isOpen && isAuthenticated) void fetchNotifications();
  }, [fetchNotifications, isAuthenticated, isOpen]);

  useEffect(() => {
    if (!isOpen || !hasBlockingModalOpen) return;
    setIsOpen(false);
  }, [hasBlockingModalOpen, isOpen]);

  useEffect(() => {
    setVisibleCount(GITHUB_NOTIFICATION_PAGE_SIZE);
  }, [filter]);

  const handleSelectNotification = useCallback(
    (notification: GitHubNotification) => {
      setIsOpen(false);
      const target = getGitHubNotificationTarget(notification);

      if (target.type === "pullRequest") {
        openPRBuffer(target.number, { repoPath: target.repoPath, title: notification.title });
      } else if (target.type === "issue") {
        openGitHubIssueBuffer({
          issueNumber: target.number,
          repoPath: target.repoPath,
          title: notification.title,
          url: notification.url,
        });
      } else if (target.type === "action") {
        openGitHubActionBuffer({
          runId: target.runId,
          repoPath: target.repoPath,
          title: notification.title,
          url: notification.url,
        });
      } else if (target.type === "actionNotification") {
        openGitHubActionBuffer({
          notification: target.notification,
          repoPath: target.repoPath,
          title: notification.title,
        });
      } else {
        void openUrl(target.url);
      }
    },
    [openGitHubActionBuffer, openGitHubIssueBuffer, openPRBuffer],
  );

  const notificationCount = notifications.length;
  const tooltipLabel = notificationCount ? `Notifications (${notificationCount})` : "Notifications";

  return (
    <>
      <Tooltip content={tooltipLabel} side="bottom">
        <Button
          ref={buttonRef}
          type="button"
          variant="ghost"
          size="icon-xs"
          active={isOpen}
          className="relative"
          onClick={() => setIsOpen((open) => !open)}
          aria-expanded={isOpen}
          aria-haspopup="menu"
          aria-label={tooltipLabel}
        >
          <Bell className="size-4" />
          {notificationCount > 0 ? (
            <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-primary ring-1 ring-background" />
          ) : null}
        </Button>
      </Tooltip>
      <Dropdown
        isOpen={isOpen}
        anchorRef={buttonRef}
        anchorAlign="end"
        onClose={() => setIsOpen(false)}
        className="w-95 overflow-hidden rounded-xl p-0"
      >
        <div className="space-y-2 border-border/70 border-b px-3 py-2">
          <div className="font-medium text-foreground ui-text-base">Notifications</div>
          <Tabs
            value={filter}
            onValueChange={(value) => setFilter(value as GitHubNotificationFilter)}
          >
            <TabsList variant="bare" className="w-full">
              <TabsTrigger value="all" size="xs">
                All
              </TabsTrigger>
              <TabsTrigger value="pulls-and-issues" size="xs">
                Pulls &amp; issues
              </TabsTrigger>
              <TabsTrigger value="workflows" size="xs">
                Workflows
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {!isAuthenticated ? (
          <GitHubAuthStatusMessage />
        ) : error ? (
          <Empty tone="error" role="alert">
            <EmptyHeader>
              <EmptyTitle>Could not load notifications</EmptyTitle>
              <EmptyDescription>{error}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button type="button" size="xs" onClick={() => void fetchNotifications(true)}>
                Try again
              </Button>
            </EmptyContent>
          </Empty>
        ) : isLoading && notifications.length === 0 ? (
          <Empty>
            <EmptyContent>
              <Spinner label="Loading notifications" showLabel compact />
            </EmptyContent>
          </Empty>
        ) : notifications.length === 0 ? (
          <EmptyState message="No unread notifications." />
        ) : filteredNotifications.length === 0 ? (
          <EmptyState message="No notifications match this filter." />
        ) : (
          <div className="max-h-96 min-w-0 overflow-x-hidden overflow-y-auto p-1">
            {notificationGroups.map((group) => (
              <section key={group.label} className="min-w-0">
                <div className={menuLabelVariants()}>{group.label}</div>
                <ItemGroup className="min-w-0 gap-0.5">
                  {group.notifications.map((notification) => {
                    const reason = notificationReasonLabel(notification.reason);
                    const time = getTimeAgo(notification.updatedAt, { includeAgo: false });
                    return (
                      <Item
                        key={notification.id}
                        render={<button type="button" />}
                        size="xs"
                        className="min-w-0 flex-nowrap text-left"
                        onClick={() => handleSelectNotification(notification)}
                      >
                        <ItemMedia variant="icon">
                          <NotificationIcon subjectType={notification.subjectType} />
                        </ItemMedia>
                        <ItemContent>
                          <ItemTitle className="w-full">{notification.title}</ItemTitle>
                          <ItemDescription className="line-clamp-1">
                            {notification.repositoryFullName} · {reason} · {time}
                          </ItemDescription>
                        </ItemContent>
                      </Item>
                    );
                  })}
                </ItemGroup>
              </section>
            ))}
            {visibleNotifications.length < filteredNotifications.length ? (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="mt-1 w-full"
                onClick={() => setVisibleCount((count) => count + GITHUB_NOTIFICATION_PAGE_SIZE)}
              >
                Show more
              </Button>
            ) : null}
          </div>
        )}
      </Dropdown>
    </>
  );
}
