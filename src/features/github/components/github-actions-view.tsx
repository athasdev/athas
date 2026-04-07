import { invoke } from "@tauri-apps/api/core";
import { Activity, AlertCircle } from "lucide-react";
import { GitHubCliStatusMessage } from "./github-cli-status";
import {
  memo,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { useRepositoryStore } from "@/features/git/stores/git-repository-store";
import GitHubSidebarLoadingBar from "./github-sidebar-loading-bar";
import { useGitHubStore } from "../stores/github-store";
import type { WorkflowRunListItem } from "../types/github";
import {
  GITHUB_ACTION_DETAILS_TTL_MS,
  GITHUB_ACTION_LIST_TTL_MS,
  githubActionDetailsCache,
  githubActionListCache,
} from "../utils/github-data-cache";
import { Button } from "@/ui/button";

interface WorkflowRunRowProps {
  run: WorkflowRunListItem;
  isActive: boolean;
  onSelect: () => void;
  onPrefetch: () => void;
}

const WorkflowRunRow = memo(({ run, isActive, onSelect, onPrefetch }: WorkflowRunRowProps) => (
  <Button
    onClick={onSelect}
    onMouseEnter={onPrefetch}
    onFocus={onPrefetch}
    variant="ghost"
    size="sm"
    active={isActive}
    className="h-auto w-full min-w-0 items-start justify-start rounded-xl px-3 py-2.5 text-left"
  >
    <div className="grid size-5 shrink-0 place-content-center rounded-full bg-secondary-bg text-text-lighter">
      <Activity className="size-3.5" />
    </div>
    <div className="min-w-0 flex-1">
      <div className="ui-text-sm truncate leading-4 text-text">
        {run.displayTitle || run.name || run.workflowName || `Run #${run.databaseId}`}
      </div>
      <div className="ui-text-sm mt-1 text-text-lighter">
        {[
          run.workflowName,
          run.headBranch ? `on ${run.headBranch}` : null,
          run.conclusion || run.status,
        ]
          .filter(Boolean)
          .join(" · ")}
      </div>
    </div>
  </Button>
));

WorkflowRunRow.displayName = "WorkflowRunRow";

interface GitHubActionsViewProps {
  refreshNonce?: number;
}

const GitHubActionsView = memo(({ refreshNonce = 0 }: GitHubActionsViewProps) => {
  const rootFolderPath = useFileSystemStore.use.rootFolderPath?.();
  const activeRepoPath = useRepositoryStore.use.activeRepoPath();
  const repoPath = activeRepoPath ?? rootFolderPath ?? null;
  const { isAuthenticated } = useGitHubStore();
  const { checkAuth } = useGitHubStore().actions;
  const { openGitHubActionBuffer } = useBufferStore.use.actions();
  const buffers = useBufferStore.use.buffers();
  const activeBufferId = useBufferStore.use.activeBufferId();
  const activeRunId = useMemo(() => {
    const activeBuffer = buffers.find((buffer) => buffer.id === activeBufferId);
    return activeBuffer?.type === "githubAction" ? activeBuffer.runId : null;
  }, [activeBufferId, buffers]);
  const [runs, setRuns] = useState<WorkflowRunListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deferredRuns = useDeferredValue(runs);

  const fetchRuns = useCallback(
    async (force = false) => {
      if (!repoPath) {
        setRuns([]);
        setError("No repository selected.");
        setIsLoading(false);
        return;
      }

      const cached = githubActionListCache.getFreshValue(repoPath, GITHUB_ACTION_LIST_TTL_MS);
      if (cached && !force) {
        startTransition(() => setRuns(cached));
        setError(null);
        setIsLoading(false);
        return;
      }

      const stale = githubActionListCache.getSnapshot(repoPath)?.value;
      if (stale && !force) {
        startTransition(() => setRuns(stale));
      }

      setIsLoading(true);
      setError(null);

      try {
        const nextRuns = await githubActionListCache.load(
          repoPath,
          () => invoke<WorkflowRunListItem[]>("github_list_workflow_runs", { repoPath }),
          { force, ttlMs: GITHUB_ACTION_LIST_TTL_MS },
        );
        startTransition(() => setRuns(nextRuns));

        for (const run of nextRuns.slice(0, 3)) {
          const cacheKey = `${repoPath}::${run.databaseId}`;
          void githubActionDetailsCache.load(
            cacheKey,
            () => invoke("github_get_workflow_run_details", { repoPath, runId: run.databaseId }),
            { ttlMs: GITHUB_ACTION_DETAILS_TTL_MS },
          );
        }
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : String(nextError));
      } finally {
        setIsLoading(false);
      }
    },
    [repoPath],
  );

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void checkAuth();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [checkAuth]);

  useEffect(() => {
    if (!isAuthenticated) return;

    let timeoutId: number | null = null;
    const frameId = window.requestAnimationFrame(() => {
      timeoutId = window.setTimeout(() => {
        void fetchRuns();
      }, 0);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [fetchRuns, isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated && refreshNonce > 0) {
      void fetchRuns(true);
    }
  }, [fetchRuns, isAuthenticated, refreshNonce]);

  if (!isAuthenticated) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <GitHubCliStatusMessage />
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      <GitHubSidebarLoadingBar isVisible={isLoading} className="mx-2 mb-1 mt-1" />
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        {error ? (
          <div className="flex items-center gap-2 px-2 py-3 text-error">
            <AlertCircle className="size-4" />
            <p className="ui-text-sm">{error}</p>
          </div>
        ) : deferredRuns.length === 0 && !isLoading ? (
          <div className="flex items-center gap-2 px-2 py-3 text-text-lighter">
            <Activity className="size-4" />
            <p className="ui-text-sm">No workflow runs</p>
          </div>
        ) : (
          <div className="space-y-1 overflow-x-hidden">
            {deferredRuns.map((run) => (
              <WorkflowRunRow
                key={run.databaseId}
                run={run}
                isActive={activeRunId === run.databaseId}
                onPrefetch={() => {
                  if (!repoPath) return;
                  const cacheKey = `${repoPath}::${run.databaseId}`;
                  void githubActionDetailsCache.load(
                    cacheKey,
                    () =>
                      invoke("github_get_workflow_run_details", {
                        repoPath,
                        runId: run.databaseId,
                      }),
                    { ttlMs: GITHUB_ACTION_DETAILS_TTL_MS },
                  );
                }}
                onSelect={() =>
                  startTransition(() => {
                    openGitHubActionBuffer({
                      runId: run.databaseId,
                      repoPath: repoPath ?? undefined,
                      title:
                        run.displayTitle ||
                        run.name ||
                        run.workflowName ||
                        `Run #${run.databaseId}`,
                      url: run.url,
                    });
                  })
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

GitHubActionsView.displayName = "GitHubActionsView";

export default GitHubActionsView;
