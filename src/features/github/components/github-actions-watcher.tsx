import { useCallback, useEffect, useRef } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useRepositoryStore } from "@/features/git/stores/git-repository.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { createTimedResourceCache } from "@/utils/timed-resource-cache";
import { fetchNormalizedPRDetails } from "../services/github-pr-store-service";
import { notifyWorkflowRunChanges } from "../services/github-workflow-notifications";
import { useGitHubActionsStore } from "../stores/github-actions.store";
import { useGitHubStore } from "../stores/github.store";
import type { PullRequestDetails, WorkflowRunListItem } from "../types/github.types";
import { filterRelevantWorkflowChanges } from "../utils/github-workflow-relevance";
import { diffWorkflowRuns } from "../utils/github-workflow-run-changes";
import { getWorkflowRunTitle, isWorkflowRunActive } from "../utils/github-workflow-status";

const ACTIVE_POLL_INTERVAL_MS = 15_000;
const IDLE_POLL_INTERVAL_MS = 60_000;
const HIDDEN_POLL_INTERVAL_MS = 90_000;

export function useWorkflowRunWatcher() {
  const rootFolderPath = useFileSystemStore.use.rootFolderPath?.();
  const activeRepoPath = useRepositoryStore.use.activeRepoPath();
  const repoPath = activeRepoPath ?? rootFolderPath ?? null;
  const isAuthenticated = useGitHubStore.use.isAuthenticated();
  const currentUser = useGitHubStore.use.currentUser();
  const checkAuth = useGitHubStore.use.actions().checkAuth;
  const notificationsEnabled = useSettingsStore(
    (state) => state.settings.githubActionNotifications,
  );
  const showGitHubActions = useSettingsStore((state) => state.settings.showGitHubActions);
  const loadRuns = useGitHubActionsStore.use.actions().loadRuns;
  const openGitHubActionBuffer = useBufferStore.use.actions().openGitHubActionBuffer;
  const lastRunsRef = useRef<{ repoPath: string; runs: WorkflowRunListItem[] } | null>(null);

  const openRun = useCallback(
    (run: WorkflowRunListItem) => {
      openGitHubActionBuffer({
        runId: run.databaseId,
        repoPath: repoPath ?? undefined,
        title: getWorkflowRunTitle(run),
        url: run.url,
      });
    },
    [openGitHubActionBuffer, repoPath],
  );

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    const enabled = isAuthenticated && repoPath && (notificationsEnabled || showGitHubActions);
    if (!enabled) {
      lastRunsRef.current = null;
      return;
    }

    let cancelled = false;
    let timeoutId: number | null = null;
    let polling = false;
    const pullRequests = createTimedResourceCache<PullRequestDetails>();

    const schedule = (runs: WorkflowRunListItem[] | null) => {
      if (cancelled) return;
      const hasActiveRuns = runs?.some((run) => isWorkflowRunActive(run)) ?? false;
      const delay =
        document.visibilityState === "hidden"
          ? HIDDEN_POLL_INTERVAL_MS
          : hasActiveRuns
            ? ACTIVE_POLL_INTERVAL_MS
            : IDLE_POLL_INTERVAL_MS;
      timeoutId = window.setTimeout(() => void poll(true), delay);
    };

    const poll = async (force: boolean) => {
      if (cancelled || polling) return;
      polling = true;
      try {
        const runs = await loadRuns(repoPath, { force, quiet: true });
        if (cancelled) return;

        if (runs) {
          const previous =
            lastRunsRef.current?.repoPath === repoPath ? lastRunsRef.current.runs : null;
          lastRunsRef.current = { repoPath, runs };

          if (notificationsEnabled) {
            const changes = await filterRelevantWorkflowChanges(
              diffWorkflowRuns(previous, runs),
              currentUser,
              (number) =>
                pullRequests.load(
                  String(number),
                  () => fetchNormalizedPRDetails(repoPath, number),
                  {
                    ttlMs: IDLE_POLL_INTERVAL_MS,
                  },
                ),
            );
            if (cancelled) return;
            void notifyWorkflowRunChanges(changes, openRun);
          }
        }

        schedule(runs ?? lastRunsRef.current?.runs ?? null);
      } finally {
        polling = false;
      }
    };

    const pollNow = () => {
      if (document.visibilityState !== "visible") return;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      void poll(true);
    };

    void poll(false);
    window.addEventListener("focus", pollNow);
    document.addEventListener("visibilitychange", pollNow);

    return () => {
      cancelled = true;
      lastRunsRef.current = null;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      window.removeEventListener("focus", pollNow);
      document.removeEventListener("visibilitychange", pollNow);
    };
  }, [
    currentUser,
    isAuthenticated,
    loadRuns,
    notificationsEnabled,
    openRun,
    repoPath,
    showGitHubActions,
  ]);
}

export function GitHubActionsWatcher() {
  useWorkflowRunWatcher();
  return null;
}
