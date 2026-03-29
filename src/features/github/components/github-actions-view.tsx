import { invoke } from "@tauri-apps/api/core";
import { Activity, AlertCircle, RefreshCw } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { useRepositoryStore } from "@/features/git/stores/git-repository-store";
import type { WorkflowRunListItem } from "../types/github";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";

const WORKFLOW_RUN_LIST_CACHE_TTL_MS = 30_000;
const workflowRunListCache = new Map<string, { fetchedAt: number; runs: WorkflowRunListItem[] }>();

interface WorkflowRunRowProps {
  run: WorkflowRunListItem;
  isActive: boolean;
  onSelect: () => void;
}

const WorkflowRunRow = memo(({ run, isActive, onSelect }: WorkflowRunRowProps) => (
  <Button
    onClick={onSelect}
    variant="ghost"
    size="sm"
    active={isActive}
    className="h-auto w-full items-start justify-start rounded-xl px-3 py-2.5 text-left"
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

const GitHubActionsView = memo(() => {
  const rootFolderPath = useFileSystemStore.use.rootFolderPath?.();
  const activeRepoPath = useRepositoryStore.use.activeRepoPath();
  const repoPath = activeRepoPath ?? rootFolderPath ?? null;
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

  const fetchRuns = useCallback(
    async (force = false) => {
      if (!repoPath) {
        setRuns([]);
        setError("No repository selected.");
        setIsLoading(false);
        return;
      }

      const cached = workflowRunListCache.get(repoPath);
      if (cached && !force && Date.now() - cached.fetchedAt < WORKFLOW_RUN_LIST_CACHE_TTL_MS) {
        setRuns(cached.runs);
        setError(null);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const nextRuns = await invoke<WorkflowRunListItem[]>("github_list_workflow_runs", {
          repoPath,
        });
        workflowRunListCache.set(repoPath, { fetchedAt: Date.now(), runs: nextRuns });
        setRuns(nextRuns);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : String(nextError));
      } finally {
        setIsLoading(false);
      }
    },
    [repoPath],
  );

  useEffect(() => {
    void fetchRuns();
  }, [fetchRuns]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="ui-text-sm text-text">Actions</div>
        <Button
          onClick={() => void fetchRuns(true)}
          variant="ghost"
          size="icon-xs"
          aria-label="Refresh workflow runs"
        >
          <RefreshCw className={cn(isLoading && "animate-spin")} />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {error ? (
          <div className="flex items-center gap-2 px-2 py-3 text-error">
            <AlertCircle className="size-4" />
            <p className="ui-text-sm">{error}</p>
          </div>
        ) : runs.length === 0 && !isLoading ? (
          <div className="flex items-center gap-2 px-2 py-3 text-text-lighter">
            <Activity className="size-4" />
            <p className="ui-text-sm">No workflow runs</p>
          </div>
        ) : (
          <div className="space-y-1">
            {runs.map((run) => (
              <WorkflowRunRow
                key={run.databaseId}
                run={run}
                isActive={activeRunId === run.databaseId}
                onSelect={() =>
                  openGitHubActionBuffer({
                    runId: run.databaseId,
                    repoPath: repoPath ?? undefined,
                    title:
                      run.displayTitle || run.name || run.workflowName || `Run #${run.databaseId}`,
                    url: run.url,
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
