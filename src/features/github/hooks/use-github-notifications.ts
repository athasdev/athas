import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useGitHubStore } from "@/features/github/stores/github.store";
import type { GitHubNotification } from "@/features/github/types/github.types";
import {
  GITHUB_NOTIFICATIONS_INTERVAL_MS,
  notificationsQuery,
} from "@/features/github/services/github-queries";
import { getGitHubNotificationTarget } from "@/features/github/services/github-notification-routing";
import { getQueryErrorMessage } from "@/utils/query-client";

const EMPTY_NOTIFICATIONS: GitHubNotification[] = [];

export function useGitHubNotifications() {
  const isAuthenticated = useGitHubStore.use.isAuthenticated();
  const currentUser = useGitHubStore.use.currentUser();
  const checkAuth = useGitHubStore.use.actions().checkAuth;
  const { openPRBuffer, openGitHubIssueBuffer, openGitHubActionBuffer } =
    useBufferStore.use.actions();
  // Keyed by the account, so a sign-out or account switch never shows the previous inbox.
  const query = useQuery({
    ...notificationsQuery(isAuthenticated ? currentUser : null),
    refetchInterval: GITHUB_NOTIFICATIONS_INTERVAL_MS,
  });
  const notifications = query.data ?? EMPTY_NOTIFICATIONS;
  const refetchNotifications = query.refetch;
  const refresh = useCallback(
    async (force = false) => {
      if (force || query.isStale) await refetchNotifications();
    },
    [query.isStale, refetchNotifications],
  );

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

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
    isLoading: query.isFetching,
    error: getQueryErrorMessage(query.error),
    refresh,
    openNotification,
  };
}
