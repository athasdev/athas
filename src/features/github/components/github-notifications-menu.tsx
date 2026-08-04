import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { getRemotes } from "@/features/git/api/git-remotes-api";
import { useRepositoryStore } from "@/features/git/stores/git-repository.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { Button } from "@/ui/button";
import { Dropdown } from "@/ui/dropdown";
import {
  ArrowClockwiseIcon as Refresh,
  BellIcon as Bell,
  ChatCircleTextIcon as MessageSquare,
  GitPullRequestIcon as GitPullRequest,
  LightningIcon as Lightning,
  WarningCircleIcon as AlertCircle,
} from "@/ui/icons";
import { Spinner } from "@/ui/spinner";
import Tooltip from "@/ui/tooltip";
import { useGitHubStore } from "../stores/github.store";
import type { GitHubNotification } from "../types/github.types";
import {
  GITHUB_NOTIFICATION_LIST_TTL_MS,
  githubNotificationListCache,
} from "../utils/github-data-cache";
import { isGitHubEntityLinkForRepository, parseGitHubEntityLink } from "../utils/github-link-utils";
import { getTimeAgo } from "../utils/github-viewer-utils";
import { GitHubAuthStatusMessage } from "./github-auth-status";

function notificationReasonLabel(reason: string): string {
  return reason.replace(/_/g, " ");
}

function NotificationIcon({ subjectType }: { subjectType: string }) {
  if (subjectType === "PullRequest") return <GitPullRequest className="size-4 text-primary" />;
  if (subjectType === "Issue") return <MessageSquare className="size-4 text-success" />;
  if (subjectType === "CheckSuite") return <Lightning className="size-4 text-warning" />;
  return <Bell className="size-4 text-primary" />;
}

export function GitHubNotificationsMenu() {
  const rootFolderPath = useFileSystemStore.use.rootFolderPath?.();
  const activeRepoPath = useRepositoryStore.use.activeRepoPath();
  const repoPath = activeRepoPath ?? rootFolderPath ?? null;
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
  const buttonRef = useRef<HTMLButtonElement>(null);

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
    if (isAuthenticated) void fetchNotifications();
  }, [fetchNotifications, isAuthenticated]);

  useEffect(() => {
    if (!isOpen || !hasBlockingModalOpen) return;
    setIsOpen(false);
  }, [hasBlockingModalOpen, isOpen]);

  const handleSelectNotification = useCallback(
    async (notification: GitHubNotification) => {
      setIsOpen(false);
      const link = parseGitHubEntityLink(notification.url);
      const remotes = repoPath ? await getRemotes(repoPath) : [];
      const canOpenNatively =
        link && remotes.some((remote) => isGitHubEntityLinkForRepository(link, remote.url));

      if (canOpenNatively && link?.kind === "pullRequest") {
        openPRBuffer(link.number, { repoPath: repoPath ?? undefined, title: notification.title });
        return;
      }
      if (canOpenNatively && link?.kind === "issue") {
        openGitHubIssueBuffer({
          issueNumber: link.number,
          repoPath: repoPath ?? undefined,
          title: notification.title,
          url: notification.url,
        });
        return;
      }
      if (canOpenNatively && link?.kind === "actionRun") {
        openGitHubActionBuffer({
          runId: link.runId,
          repoPath: repoPath ?? undefined,
          title: notification.title,
          url: notification.url,
        });
        return;
      }
      if (notification.url) await openUrl(notification.url);
    },
    [openGitHubActionBuffer, openGitHubIssueBuffer, openPRBuffer, repoPath],
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
        className="w-[380px] overflow-hidden rounded-xl p-0"
      >
        <div className="flex items-center justify-between border-border/70 border-b px-3 py-2">
          <div className="min-w-0">
            <div className="font-medium text-foreground ui-text-base">Notifications</div>
            <div className="text-subtle-foreground ui-text-sm">
              {notificationCount === 1
                ? "1 unread notification"
                : `${notificationCount} unread notifications`}
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={!isAuthenticated || isLoading}
            onClick={() => void fetchNotifications(true)}
            tooltip="Refresh notifications"
            tooltipSide="left"
            aria-label="Refresh notifications"
          >
            {isLoading ? <Spinner label="Refreshing notifications" compact /> : <Refresh />}
          </Button>
        </div>

        {!isAuthenticated ? (
          <GitHubAuthStatusMessage />
        ) : error ? (
          <div className="p-4" role="alert">
            <div className="flex items-start gap-2 text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0">
                <div className="font-medium ui-text-sm">Could not load notifications</div>
                <div className="mt-1 break-words text-subtle-foreground ui-text-sm">{error}</div>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="mt-2 h-auto px-0 text-primary hover:bg-transparent"
                  onClick={() => void fetchNotifications(true)}
                >
                  Try again
                </Button>
              </div>
            </div>
          </div>
        ) : isLoading && notifications.length === 0 ? (
          <div className="flex items-center justify-center p-6">
            <Spinner label="Loading notifications" showLabel compact />
          </div>
        ) : notifications.length === 0 ? (
          <div className="p-6 text-center text-subtle-foreground ui-text-sm">
            No unread notifications.
          </div>
        ) : (
          <div className="max-h-[360px] overflow-y-auto p-1">
            {notifications.map((notification) => {
              const reason = notificationReasonLabel(notification.reason);
              return (
                <button
                  key={notification.id}
                  type="button"
                  className="flex h-9 w-full min-w-0 items-center gap-2 rounded-lg px-2.5 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                  onClick={() => void handleSelectNotification(notification)}
                >
                  <span className="flex size-5 shrink-0 items-center justify-center">
                    <NotificationIcon subjectType={notification.subjectType} />
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground ui-text-sm">
                    {notification.title}
                  </span>
                  <span className="flex min-w-0 max-w-[52%] shrink items-center gap-1.5 text-subtle-foreground ui-text-sm">
                    <span className="truncate">{notification.repositoryFullName}</span>
                    <span aria-hidden="true">·</span>
                    <span className="shrink-0 capitalize">{reason}</span>
                    <span aria-hidden="true">·</span>
                    <span className="shrink-0">{getTimeAgo(notification.updatedAt)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </Dropdown>
    </>
  );
}
