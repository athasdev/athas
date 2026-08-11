import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useRepositoryStore } from "@/features/git/stores/git-repository.store";
import { openCommitDiffBuffer } from "@/features/git/utils/open-commit-diff-buffer";
import { useUIState } from "@/features/window/stores/ui-state.store";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import { Dropdown } from "@/ui/dropdown";
import {
  BellIcon as Bell,
  ChatCircleTextIcon as MessageSquare,
  GitPullRequestIcon as GitPullRequest,
  LightningIcon as Lightning,
  WarningCircleIcon as AlertCircle,
} from "@/ui/icons";
import { Spinner } from "@/ui/spinner";
import Tooltip from "@/ui/tooltip";
import { toast } from "sonner";
import { useGitHubStore } from "../stores/github.store";
import type { GitHubNotification, WorkflowRunListItem } from "../types/github.types";
import {
  GITHUB_NOTIFICATION_LIST_TTL_MS,
  githubNotificationListCache,
} from "../utils/github-data-cache";
import {
  isGitHubEntityLinkForRepository,
  parseGitHubCheckSuiteId,
  parseGitHubEntityLink,
} from "../utils/github-link-utils";
import { resolveGitHubNotificationRepoPath } from "../utils/github-notification-routing";
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
  const availableRepoPaths = useRepositoryStore.use.availableRepoPaths();
  const repoPath = activeRepoPath ?? rootFolderPath ?? null;
  const isAuthenticated = useGitHubStore.use.isAuthenticated();
  const { checkAuth } = useGitHubStore.use.actions();
  const { openPRBuffer, openGitHubIssueBuffer, openGitHubActionBuffer, openWebViewerBuffer } =
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

  const handleSelectNotification = useCallback(
    async (notification: GitHubNotification) => {
      setIsOpen(false);
      const link = parseGitHubEntityLink(notification.url);
      const repositoryUrl = `https://github.com/${notification.repositoryFullName}`;
      const targetRepoPath = await resolveGitHubNotificationRepoPath(
        notification.repositoryFullName,
        repoPath ? [repoPath, ...availableRepoPaths] : availableRepoPaths,
      );
      const canOpenNatively =
        targetRepoPath && link && isGitHubEntityLinkForRepository(link, repositoryUrl);

      if (canOpenNatively && link?.kind === "pullRequest") {
        openPRBuffer(link.number, { repoPath: targetRepoPath, title: notification.title });
        return;
      }
      if (canOpenNatively && link?.kind === "issue") {
        openGitHubIssueBuffer({
          issueNumber: link.number,
          repoPath: targetRepoPath,
          title: notification.title,
          url: notification.url,
        });
        return;
      }
      if (canOpenNatively && link?.kind === "actionRun") {
        openGitHubActionBuffer({
          runId: link.runId,
          repoPath: targetRepoPath,
          title: notification.title,
          url: notification.url,
        });
        return;
      }

      if (canOpenNatively && link?.kind === "commit" && !targetRepoPath.startsWith("github://")) {
        const bufferId = await openCommitDiffBuffer({
          repoPath: targetRepoPath,
          commitHash: link.sha,
          message: notification.title,
        });
        if (bufferId) return;
      }

      const checkSuiteId = parseGitHubCheckSuiteId(notification.subjectUrl);
      if (targetRepoPath && notification.subjectType === "CheckSuite") {
        try {
          const run = await invoke<WorkflowRunListItem | null>(
            "github_resolve_notification_workflow_run",
            {
              repositoryFullName: notification.repositoryFullName,
              checkSuiteId,
              notificationTitle: notification.title,
              notificationUpdatedAt: notification.updatedAt,
            },
          );
          if (run) {
            openGitHubActionBuffer({
              runId: run.databaseId,
              repoPath: targetRepoPath,
              title: run.displayTitle || run.name || run.workflowName || notification.title,
              url: run.url,
            });
            return;
          }
        } catch (nextError) {
          toast.error(
            nextError instanceof Error
              ? nextError.message
              : "Failed to resolve the GitHub Actions run",
          );
          return;
        }

        toast.error("Could not match this notification to a GitHub Actions run.");
        return;
      }

      openWebViewerBuffer(notification.url || repositoryUrl);
    },
    [
      availableRepoPaths,
      openGitHubActionBuffer,
      openGitHubIssueBuffer,
      openPRBuffer,
      openWebViewerBuffer,
      repoPath,
    ],
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
        <div className="flex items-center gap-2 border-border/70 border-b px-3 py-2">
          <div className="font-medium text-foreground ui-text-base">Notifications</div>
          <Badge variant="accent" size="compact" className="h-5 min-w-5 tabular-nums">
            {notificationCount}
          </Badge>
        </div>

        {!isAuthenticated ? (
          <GitHubAuthStatusMessage />
        ) : error ? (
          <div className="p-4" role="alert">
            <div className="flex items-start gap-2 text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0">
                <div className="font-medium ui-text-sm">Could not load notifications</div>
                <div className="mt-1 wrap-break-word text-subtle-foreground ui-text-sm">
                  {error}
                </div>
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
          <div className="max-h-90 overflow-y-auto p-1">
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
