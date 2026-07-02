import { invoke } from "@tauri-apps/api/core";
import {
  CheckCircleIcon as CheckCircle2,
  ClockIcon as Clock,
  PulseIcon as Activity,
  WarningCircleIcon as AlertCircle,
  XCircleIcon as XCircle,
} from "@phosphor-icons/react";
import { GitHubAuthStatusMessage } from "./github-auth-status";
import { GitHubSidebarState } from "./github-sidebar-state";
import {
  memo,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useRepositoryStore } from "@/features/git/stores/git-repository.store";
import { writeSidebarResourceDragData } from "@/features/sidebar-drag/utils/sidebar-resource-drag";
import { useGitHubStore } from "../stores/github.store";
import type {
  WorkflowRunDetails,
  WorkflowRunFilter,
  WorkflowRunListItem,
} from "../types/github.types";
import {
  GITHUB_ACTION_DETAILS_TTL_MS,
  GITHUB_ACTION_LIST_TTL_MS,
  githubActionDetailsCache,
  githubActionListCache,
} from "../utils/github-data-cache";
import { LoadingIndicator } from "@/ui/loading";
import { SidebarListItem } from "@/ui/sidebar";
import { cn } from "@/utils/cn";

const getWorkflowRunStatus = (status?: string | null, conclusion?: string | null) => {
  const normalizedStatus = status?.toLowerCase() ?? "";
  const normalizedConclusion = conclusion?.toLowerCase() ?? "";

  if (normalizedConclusion === "success") {
    return {
      label: "Success",
      icon: CheckCircle2,
      className: "text-success",
      animate: false,
    };
  }

  if (
    normalizedConclusion === "failure" ||
    normalizedConclusion === "timed_out" ||
    normalizedConclusion === "startup_failure"
  ) {
    return {
      label: "Failed",
      icon: XCircle,
      className: "text-error",
      animate: false,
    };
  }

  if (normalizedConclusion === "cancelled" || normalizedConclusion === "skipped") {
    return {
      label: normalizedConclusion === "skipped" ? "Skipped" : "Cancelled",
      icon: XCircle,
      className: "text-text-lighter",
      animate: false,
    };
  }

  if (
    normalizedStatus === "in_progress" ||
    normalizedStatus === "waiting" ||
    normalizedStatus === "requested"
  ) {
    return {
      label: "Running",
      icon: null,
      className: "text-accent",
      animate: true,
    };
  }

  if (normalizedStatus === "queued" || normalizedStatus === "pending") {
    return {
      label: "Queued",
      icon: Clock,
      className: "text-warning",
      animate: false,
    };
  }

  return {
    label: normalizedConclusion || normalizedStatus || "Unknown",
    icon: Activity,
    className: "text-text-lighter",
    animate: false,
  };
};

function WorkflowRunStatusIcon({
  status,
  conclusion,
}: {
  status?: string | null;
  conclusion?: string | null;
}) {
  const state = getWorkflowRunStatus(status, conclusion);
  const Icon = state.icon;

  return (
    <span
      aria-label={state.label}
      title={state.label}
      className={cn("grid size-5 place-content-center", state.className)}
    >
      {state.animate || !Icon ? (
        <LoadingIndicator label={state.label} compact />
      ) : (
        <Icon className="size-4" weight="fill" />
      )}
    </span>
  );
}

interface WorkflowRunRowProps {
  run: WorkflowRunListItem;
  isActive: boolean;
  onSelect: () => void;
  onPrefetch?: () => void;
  repoPath?: string | null;
}

const WorkflowRunRow = memo(
  ({ run, isActive, onSelect, onPrefetch, repoPath }: WorkflowRunRowProps) => (
    <SidebarListItem
      onClick={onSelect}
      onMouseEnter={onPrefetch}
      onFocus={onPrefetch}
      onPointerDown={onPrefetch}
      draggable
      onDragStart={(event) => {
        const title = run.displayTitle || run.name || run.workflowName || `Run #${run.databaseId}`;
        writeSidebarResourceDragData(event.dataTransfer, {
          type: "github-action",
          repoPath: repoPath ?? undefined,
          runId: run.databaseId,
          title,
          url: run.url,
          name: title,
        });
      }}
      active={isActive}
      leading={<WorkflowRunStatusIcon status={run.status} conclusion={run.conclusion} />}
      description={run.workflowName}
      trailing={
        run.headBranch ? (
          <span className="editor-font max-w-32 truncate">{run.headBranch}</span>
        ) : null
      }
    >
      {run.displayTitle || run.name || run.workflowName || `Run #${run.databaseId}`}
    </SidebarListItem>
  ),
);

WorkflowRunRow.displayName = "WorkflowRunRow";

interface GitHubActionsViewProps {
  refreshNonce?: number;
  searchQuery?: string;
  filter?: WorkflowRunFilter;
}

const GitHubActionsView = memo(
  ({ refreshNonce = 0, searchQuery = "", filter = "all" }: GitHubActionsViewProps) => {
    const rootFolderPath = useFileSystemStore.use.rootFolderPath?.();
    const activeRepoPath = useRepositoryStore.use.activeRepoPath();
    const repoPath = activeRepoPath ?? rootFolderPath ?? null;
    const { isAuthenticated } = useGitHubStore();
    const { checkAuth } = useGitHubStore().actions;
    const { openGitHubActionBuffer } = useBufferStore.use.actions();
    const activeRunId = useBufferStore((state) => {
      const activeBuffer = state.activeBufferId
        ? state.buffers.find((buffer) => buffer.id === state.activeBufferId)
        : null;
      return activeBuffer?.type === "githubAction" ? activeBuffer.runId : null;
    });
    const [runs, setRuns] = useState<WorkflowRunListItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const deferredRuns = useDeferredValue(runs);
    const deferredSearchQuery = useDeferredValue(searchQuery);

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
        } catch (nextError) {
          setError(nextError instanceof Error ? nextError.message : String(nextError));
        } finally {
          setIsLoading(false);
        }
      },
      [repoPath],
    );

    const prefetchWorkflowRun = useCallback(
      (run: WorkflowRunListItem) => {
        if (!repoPath) return;

        const cacheKey = `${repoPath}::${run.databaseId}`;
        void githubActionDetailsCache
          .load(
            cacheKey,
            () =>
              invoke<WorkflowRunDetails>("github_get_workflow_run_details", {
                repoPath,
                runId: run.databaseId,
              }),
            { ttlMs: GITHUB_ACTION_DETAILS_TTL_MS },
          )
          .catch(() => undefined);
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

    const filteredRuns = useMemo(() => {
      const query = deferredSearchQuery.trim().toLowerCase();
      const statusFilteredRuns = deferredRuns.filter((run) => {
        if (filter === "all") return true;
        if (filter === "in-progress") {
          return (
            run.status === "queued" || run.status === "in_progress" || run.status === "waiting"
          );
        }
        if (filter === "successful") return run.conclusion === "success";
        return (
          run.conclusion === "failure" ||
          run.conclusion === "cancelled" ||
          run.conclusion === "timed_out"
        );
      });

      if (!query) return statusFilteredRuns;

      return statusFilteredRuns.filter((run) =>
        [
          run.displayTitle ?? "",
          run.name ?? "",
          run.workflowName ?? "",
          run.event ?? "",
          run.status ?? "",
          run.conclusion ?? "",
          run.headBranch ?? "",
          run.headSha ?? "",
          `#${run.databaseId}`,
        ].some((value) => value.toLowerCase().includes(query)),
      );
    }, [deferredRuns, deferredSearchQuery, filter]);

    if (!isAuthenticated) {
      return (
        <div className="flex h-full items-center justify-center p-4">
          <GitHubAuthStatusMessage />
        </div>
      );
    }

    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-1">
          {error ? (
            <GitHubSidebarState
              icon={<AlertCircle className="size-4" />}
              title={error}
              tone="error"
            />
          ) : isLoading && deferredRuns.length === 0 ? (
            <div className="flex items-center justify-center p-4">
              <LoadingIndicator label="Loading workflow runs" showLabel compact />
            </div>
          ) : deferredRuns.length === 0 ? (
            <GitHubSidebarState icon={<Activity className="size-4" />} title="No workflow runs" />
          ) : filteredRuns.length === 0 ? (
            <GitHubSidebarState
              icon={<Activity className="size-4" />}
              title="No matching workflow runs"
            />
          ) : (
            <div className="space-y-px overflow-x-hidden">
              {isLoading ? (
                <div className="flex items-center px-2 py-1.5">
                  <LoadingIndicator label="Refreshing" compact />
                </div>
              ) : null}
              {filteredRuns.map((run) => (
                <WorkflowRunRow
                  key={run.databaseId}
                  run={run}
                  isActive={activeRunId === run.databaseId}
                  repoPath={repoPath}
                  onPrefetch={() => prefetchWorkflowRun(run)}
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
  },
);

GitHubActionsView.displayName = "GitHubActionsView";

export default GitHubActionsView;
