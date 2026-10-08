import { useCallback, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { pullRequestDetailsQuery, workflowRunsQuery } from "../services/github-queries";
import { notifyWorkflowRunChanges } from "../services/github-workflow-notifications";
import { useGitHubRepoPath } from "../hooks/use-github-repo-path";
import { useGitHubStore } from "../stores/github.store";
import type { WorkflowRunListItem } from "../types/github.types";
import { filterRelevantWorkflowChanges } from "../utils/github-workflow-relevance";
import { diffWorkflowRuns } from "../utils/github-workflow-run-changes";
import { getWorkflowRunTitle, isWorkflowRunActive } from "../utils/github-workflow-status";

const ACTIVE_POLL_INTERVAL_MS = 15_000;
const IDLE_POLL_INTERVAL_MS = 60_000;
const HIDDEN_POLL_INTERVAL_MS = 90_000;

function getPollInterval(runs: WorkflowRunListItem[] | undefined) {
  if (document.visibilityState === "hidden") return HIDDEN_POLL_INTERVAL_MS;
  return runs?.some((run) => isWorkflowRunActive(run))
    ? ACTIVE_POLL_INTERVAL_MS
    : IDLE_POLL_INTERVAL_MS;
}

export function useWorkflowRunWatcher() {
  const repoPath = useGitHubRepoPath();
  const queryClient = useQueryClient();
  const isAuthenticated = useGitHubStore.use.isAuthenticated();
  const currentUser = useGitHubStore.use.currentUser();
  const checkAuth = useGitHubStore.use.actions().checkAuth;
  const notificationsEnabled = useSettingsStore(
    (state) => state.settings.githubActionNotifications,
  );
  const showGitHubActions = useSettingsStore((state) => state.settings.showGitHubActions);
  const openGitHubActionBuffer = useBufferStore.use.actions().openGitHubActionBuffer;
  const lastRunsRef = useRef<{ repoPath: string; runs: WorkflowRunListItem[] } | null>(null);
  const enabled = Boolean(
    isAuthenticated && repoPath && (notificationsEnabled || showGitHubActions),
  );

  // Polls in the background too, slower while hidden, so a finished run can still notify.
  const runs = useQuery({
    ...workflowRunsQuery(repoPath),
    enabled,
    refetchInterval: (query) => getPollInterval(query.state.data),
    refetchIntervalInBackground: true,
  }).data;

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
    if (!enabled || !repoPath) {
      lastRunsRef.current = null;
      return;
    }
    if (!runs) return;

    const previous = lastRunsRef.current?.repoPath === repoPath ? lastRunsRef.current.runs : null;
    lastRunsRef.current = { repoPath, runs };
    if (!notificationsEnabled) return;

    let cancelled = false;
    void filterRelevantWorkflowChanges(diffWorkflowRuns(previous, runs), currentUser, (number) =>
      queryClient.query({
        ...pullRequestDetailsQuery(repoPath, number),
        staleTime: IDLE_POLL_INTERVAL_MS,
      }),
    ).then((changes) => {
      if (!cancelled) void notifyWorkflowRunChanges(changes, openRun);
    });

    return () => {
      cancelled = true;
    };
  }, [currentUser, enabled, notificationsEnabled, openRun, queryClient, repoPath, runs]);
}

export function GitHubActionsWatcher() {
  useWorkflowRunWatcher();
  return null;
}
