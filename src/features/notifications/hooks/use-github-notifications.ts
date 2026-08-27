import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useGitHubStore } from "@/features/github/stores/github.store";
import type { GitHubNotification } from "@/features/github/types/github.types";
import {
  GITHUB_NOTIFICATION_LIST_TTL_MS,
  githubNotificationListCache,
} from "@/features/github/utils/github-data-cache";
import { getGitHubNotificationTarget } from "@/features/github/utils/github-notification-routing";

export function useGitHubNotifications() {
  const isAuthenticated = useGitHubStore.use.isAuthenticated();
  const checkAuth = useGitHubStore.use.actions().checkAuth;
  const { openPRBuffer, openGitHubIssueBuffer, openGitHubActionBuffer } =
    useBufferStore.use.actions();
  const [notifications, setNotifications] = useState<GitHubNotification[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (force = false) => {
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
    if (!isAuthenticated) {
      setNotifications([]);
      setError(null);
      return;
    }

    void refresh();
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh(true);
    }, GITHUB_NOTIFICATION_LIST_TTL_MS);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };

    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [isAuthenticated, refresh]);

  const openNotification = useCallback(
    (notification: GitHubNotification) => {
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

  return {
    isAuthenticated,
    notifications,
    isLoading,
    error,
    refresh,
    openNotification,
  };
}
