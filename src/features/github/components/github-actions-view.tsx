import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  CopyIcon,
  LinkIcon,
  PlayIcon,
  StopIcon,
} from "@/ui/icons";
import {
  memo,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { toast } from "sonner";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useRepositoryStore } from "@/features/git/stores/git-repository.store";
import { writeSidebarResourceDragData } from "@/features/sidebar/utils/sidebar-resource-drag";
import { GithubMark } from "@/ui/brand-marks";
import { ContextMenuPopup, createContextMenuGroups } from "@/ui/context-menu";
import { type MenuItem, useDropdownMenu } from "@/ui/dropdown";
import { EmptyState } from "@/ui/empty";
import { SidebarScrollArea, SidebarSection } from "@/ui/sidebar";
import { Spinner } from "@/ui/spinner";
import { cn } from "@/utils/cn";
import { writeClipboardText } from "@/utils/clipboard";
import { useNow } from "../hooks/use-now";
import { getWorkflowRunsEntry, useGitHubActionsStore } from "../stores/github-actions.store";
import { useGitHubStore } from "../stores/github.store";
import type {
  WorkflowRunDetails,
  WorkflowRunFilter,
  WorkflowRunListItem,
} from "../types/github.types";
import { GITHUB_ACTION_DETAILS_TTL_MS, githubActionDetailsCache } from "../utils/github-data-cache";
import { groupWorkflowRuns } from "../utils/github-sidebar-groups";
import {
  getGitHubBranchUrl,
  getGitHubCommitUrl,
  getGitHubUserUrl,
  getGitHubWorkflowRunsUrl,
  getRepositoryUrlFromEntityUrl,
} from "../utils/github-link-utils";
import { getTimeAgo, getSidebarTime } from "../utils/github-viewer-utils";
import {
  formatWorkflowDuration,
  getWorkflowRunLabel,
  getWorkflowRunState,
  getWorkflowRunTiming,
  getWorkflowRunTitle,
  isWorkflowRunActive,
  isWorkflowRunFailed,
} from "../utils/github-workflow-status";
import { GitHubAuthStatusMessage } from "./github-auth-status";
import { GitHubSidebarRow, type GitHubSidebarPreviewBadge } from "./github-sidebar-row";
import { WorkflowStatusIcon } from "./github-workflow-status-icon";

interface WorkflowRunRowProps {
  run: WorkflowRunListItem;
  isActive: boolean;
  now: number;
  pendingAction: string | undefined;
  repoPath: string | null;
  onSelect: (run: WorkflowRunListItem) => void;
  onPrefetch: (run: WorkflowRunListItem) => void;
  onContextMenu: (event: React.MouseEvent, run: WorkflowRunListItem) => void;
}

const WorkflowRunRow = memo(
  ({
    run,
    isActive,
    now,
    pendingAction,
    repoPath,
    onSelect,
    onPrefetch,
    onContextMenu,
  }: WorkflowRunRowProps) => {
    const title = getWorkflowRunTitle(run);
    const state = getWorkflowRunState(run.status, run.conclusion);
    const timing = getWorkflowRunTiming(run, now);
    const duration = formatWorkflowDuration(timing.durationMs);
    const updatedLabel = run.updatedAt ? getTimeAgo(run.updatedAt) : null;
    const trailing = state.isActive
      ? duration
      : run.updatedAt
        ? getSidebarTime(run.updatedAt)
        : null;
    const shortSha = run.headSha ? run.headSha.slice(0, 7) : null;
    const repositoryUrl = getRepositoryUrlFromEntityUrl(run.url);
    const leading = pendingAction ? (
      <Spinner label={pendingAction === "cancel" ? "Cancelling" : "Re-running"} compact />
    ) : (
      <WorkflowStatusIcon status={run.status} conclusion={run.conclusion} />
    );
    const badges: GitHubSidebarPreviewBadge[] = [
      { label: state.label, tone: state.tone === "error" ? "error" : state.tone },
      ...(run.runAttempt && run.runAttempt > 1
        ? [
            {
              label: `Attempt ${run.runAttempt}`,
              tone: "warning",
            } satisfies GitHubSidebarPreviewBadge,
          ]
        : []),
      ...(run.event
        ? [{ label: run.event, tone: "muted" } satisfies GitHubSidebarPreviewBadge]
        : []),
      ...(run.headBranch
        ? [{ label: run.headBranch, tone: "default" } satisfies GitHubSidebarPreviewBadge]
        : []),
    ];

    return (
      <GitHubSidebarRow
        title={title}
        description={[state.label, run.headBranch].filter(Boolean).join(" · ")}
        onClick={() => onSelect(run)}
        onPrefetch={() => onPrefetch(run)}
        onContextMenu={(event) => onContextMenu(event, run)}
        draggable
        onDragStart={(event) => {
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
        leading={leading}
        trailing={
          trailing ? (
            <span className={cn(state.isActive && "tabular-nums text-primary")}>{trailing}</span>
          ) : undefined
        }
        preview={{
          title,
          subtitle:
            run.headCommitMessage && run.headCommitMessage !== title
              ? run.headCommitMessage
              : run.workflowName || getWorkflowRunLabel(run),
          icon: <WorkflowStatusIcon status={run.status} conclusion={run.conclusion} />,
          badges,
          details: [
            {
              label: "Workflow",
              value: run.workflowName,
              mono: true,
              onClick:
                repositoryUrl && run.workflowName
                  ? () =>
                      void openUrl(getGitHubWorkflowRunsUrl(repositoryUrl, run.workflowName ?? ""))
                  : undefined,
              actionLabel: "Open workflow runs on GitHub",
            },
            {
              label: "Run",
              value: getWorkflowRunLabel(run),
              mono: true,
              onClick: run.url ? () => void openUrl(run.url) : undefined,
              actionLabel: "Open run on GitHub",
            },
            {
              label: "Branch",
              value: run.headBranch,
              mono: true,
              onClick:
                repositoryUrl && run.headBranch
                  ? () => void openUrl(getGitHubBranchUrl(repositoryUrl, run.headBranch ?? ""))
                  : undefined,
              actionLabel: "Open branch on GitHub",
            },
            {
              label: "Commit",
              value: shortSha,
              mono: true,
              onClick:
                repositoryUrl && run.headSha
                  ? () => void openUrl(getGitHubCommitUrl(repositoryUrl, run.headSha ?? ""))
                  : undefined,
              actionLabel: "Open commit on GitHub",
            },
            {
              label: "Actor",
              value: run.actor?.login,
              onClick: run.actor
                ? () => void openUrl(getGitHubUserUrl(run.actor?.login ?? ""))
                : undefined,
              actionLabel: "Open profile on GitHub",
            },
            {
              label: state.isActive ? "Elapsed" : "Duration",
              value: duration,
            },
            { label: "Updated", value: updatedLabel },
          ],
        }}
      />
    );
  },
);

WorkflowRunRow.displayName = "WorkflowRunRow";

function matchesWorkflowRunFilter(run: WorkflowRunListItem, filter: WorkflowRunFilter) {
  if (filter === "all") return true;
  if (filter === "in-progress") return isWorkflowRunActive(run);
  if (filter === "successful") return run.conclusion?.toLowerCase() === "success";
  return isWorkflowRunFailed(run) || run.conclusion?.toLowerCase() === "cancelled";
}

function matchesWorkflowRunQuery(run: WorkflowRunListItem, query: string) {
  if (!query) return true;
  return [
    run.displayTitle ?? "",
    run.name ?? "",
    run.workflowName ?? "",
    run.event ?? "",
    run.status ?? "",
    run.conclusion ?? "",
    run.headBranch ?? "",
    run.headSha ?? "",
    run.headCommitMessage ?? "",
    run.actor?.login ?? "",
    getWorkflowRunLabel(run),
    `#${run.databaseId}`,
  ].some((value) => value.toLowerCase().includes(query));
}

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
    const isAuthenticated = useGitHubStore.use.isAuthenticated();
    const { checkAuth } = useGitHubStore.use.actions();
    const { openGitHubActionBuffer } = useBufferStore.use.actions();
    const entry = useGitHubActionsStore((state) => getWorkflowRunsEntry(state.entries, repoPath));
    const pendingActions = useGitHubActionsStore.use.pendingActions();
    const { loadRuns, rerunRun, cancelRun } = useGitHubActionsStore.use.actions();
    const contextMenu = useDropdownMenu<WorkflowRunListItem>();
    const previousRefreshNonce = useRef(refreshNonce);
    const activeRunId = useBufferStore((state) => {
      const activeBuffer = state.activeBufferId
        ? state.buffers.find((buffer) => buffer.id === state.activeBufferId)
        : null;
      return activeBuffer?.type === "githubAction" ? activeBuffer.runId : null;
    });
    const deferredSearchQuery = useDeferredValue(searchQuery);
    const runs = entry.runs;
    const hasActiveRuns = useMemo(() => runs.some((run) => isWorkflowRunActive(run)), [runs]);
    const now = useNow(1_000, hasActiveRuns);

    useEffect(() => {
      const timeoutId = window.setTimeout(() => void checkAuth(), 0);
      return () => window.clearTimeout(timeoutId);
    }, [checkAuth]);

    useEffect(() => {
      if (!isAuthenticated || !repoPath) return;
      const force = previousRefreshNonce.current !== refreshNonce;
      previousRefreshNonce.current = refreshNonce;
      void loadRuns(repoPath, { force });
    }, [isAuthenticated, loadRuns, refreshNonce, repoPath]);

    const prefetchWorkflowRun = useCallback(
      (run: WorkflowRunListItem) => {
        if (!repoPath) return;
        void githubActionDetailsCache
          .load(
            `${repoPath}::${run.databaseId}`,
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

    const openRun = useCallback(
      (run: WorkflowRunListItem) => {
        startTransition(() => {
          openGitHubActionBuffer({
            runId: run.databaseId,
            repoPath: repoPath ?? undefined,
            title: getWorkflowRunTitle(run),
            url: run.url,
          });
        });
      },
      [openGitHubActionBuffer, repoPath],
    );

    const handleContextMenu = useCallback(
      (event: React.MouseEvent, run: WorkflowRunListItem) => {
        contextMenu.open(event, run);
      },
      [contextMenu],
    );

    const runAction = useCallback(async (task: () => Promise<boolean>, successMessage: string) => {
      try {
        await task();
        toast.success(successMessage);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      }
    }, []);

    const filteredRuns = useMemo(() => {
      const query = deferredSearchQuery.trim().toLowerCase();
      return runs.filter(
        (run) => matchesWorkflowRunFilter(run, filter) && matchesWorkflowRunQuery(run, query),
      );
    }, [deferredSearchQuery, filter, runs]);
    const groupedRuns = useMemo(() => groupWorkflowRuns(filteredRuns), [filteredRuns]);

    useEffect(() => {
      if (!isAuthenticated || !repoPath || filteredRuns.length === 0) return;

      let cancelled = false;
      const idleApi = window as Window & {
        requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
        cancelIdleCallback?: (id: number) => void;
      };
      const prefetchVisibleRuns = () => {
        if (cancelled) return;
        filteredRuns.slice(0, 4).forEach((run) => prefetchWorkflowRun(run));
      };
      const usesIdleCallback = typeof idleApi.requestIdleCallback === "function";
      const idleId = usesIdleCallback
        ? idleApi.requestIdleCallback?.(prefetchVisibleRuns, { timeout: 1200 })
        : window.setTimeout(prefetchVisibleRuns, 500);

      return () => {
        cancelled = true;
        if (usesIdleCallback && idleId !== undefined) {
          idleApi.cancelIdleCallback?.(idleId);
        } else if (idleId !== undefined) {
          window.clearTimeout(idleId);
        }
      };
    }, [filteredRuns, isAuthenticated, prefetchWorkflowRun, repoPath]);

    const selectedRun = contextMenu.data;
    const selectedState = selectedRun
      ? getWorkflowRunState(selectedRun.status, selectedRun.conclusion)
      : null;
    const selectedPending = selectedRun ? pendingActions[selectedRun.databaseId] : undefined;
    const contextMenuItems: MenuItem[] =
      selectedRun && selectedState && repoPath
        ? [
            {
              id: "open-run",
              label: "Open Run",
              icon: <PlayIcon />,
              onClick: () => openRun(selectedRun),
            },
            {
              id: "open-on-github",
              label: "Open on GitHub",
              icon: <GithubMark />,
              onClick: () => void openUrl(selectedRun.url),
            },
            {
              id: "copy-link",
              label: "Copy Link",
              icon: <LinkIcon />,
              onClick: () => void writeClipboardText(selectedRun.url),
            },
            {
              id: "copy-title",
              label: "Copy Title",
              icon: <CopyIcon />,
              onClick: () => void writeClipboardText(getWorkflowRunTitle(selectedRun)),
            },
            ...(selectedState.isActive
              ? [
                  {
                    id: "cancel-run",
                    label: "Cancel Run",
                    icon: <StopIcon />,
                    disabled: Boolean(selectedPending),
                    onClick: () =>
                      void runAction(
                        () => cancelRun(repoPath, selectedRun.databaseId),
                        "Cancellation requested",
                      ),
                  } satisfies MenuItem,
                ]
              : [
                  {
                    id: "rerun",
                    label: "Re-run All Jobs",
                    icon: <ArrowClockwiseIcon />,
                    disabled: Boolean(selectedPending),
                    onClick: () =>
                      void runAction(
                        () => rerunRun(repoPath, selectedRun.databaseId, false),
                        "Re-run queued",
                      ),
                  } satisfies MenuItem,
                  ...(selectedState.isFailed
                    ? [
                        {
                          id: "rerun-failed",
                          label: "Re-run Failed Jobs",
                          icon: <ArrowCounterClockwiseIcon />,
                          disabled: Boolean(selectedPending),
                          onClick: () =>
                            void runAction(
                              () => rerunRun(repoPath, selectedRun.databaseId, true),
                              "Re-run of failed jobs queued",
                            ),
                        } satisfies MenuItem,
                      ]
                    : []),
                ]),
          ]
        : [];

    if (!isAuthenticated) {
      return <GitHubAuthStatusMessage layout="sidebar" />;
    }

    const isInitialLoading = entry.isLoading && runs.length === 0;

    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-busy={entry.isLoading}>
        <SidebarScrollArea className="min-h-0 flex-1">
          {entry.error && runs.length === 0 ? (
            <EmptyState
              layout="sidebar"
              message={entry.error}
              tone="error"
              role="alert"
              action={{
                label: "Retry",
                onClick: () => repoPath && void loadRuns(repoPath, { force: true }),
                disabled: entry.isLoading,
              }}
            />
          ) : isInitialLoading ? (
            <EmptyState
              layout="sidebar"
              message={<Spinner label="Loading workflow runs" showLabel compact />}
            />
          ) : runs.length === 0 ? (
            <EmptyState layout="sidebar" message="No workflow runs yet" />
          ) : filteredRuns.length === 0 ? (
            <EmptyState layout="sidebar" message="No matching workflow runs" />
          ) : (
            <div className="min-w-0 space-y-1">
              {groupedRuns.map((group) => (
                <SidebarSection
                  forceExpanded={searchQuery.trim().length > 0}
                  key={group.id}
                  title={group.title}
                  count={group.items.length}
                >
                  {group.items.map((run) => (
                    <WorkflowRunRow
                      key={run.databaseId}
                      run={run}
                      now={now}
                      isActive={activeRunId === run.databaseId}
                      pendingAction={pendingActions[run.databaseId]}
                      repoPath={repoPath}
                      onSelect={openRun}
                      onPrefetch={prefetchWorkflowRun}
                      onContextMenu={handleContextMenu}
                    />
                  ))}
                </SidebarSection>
              ))}
            </div>
          )}
        </SidebarScrollArea>
        <ContextMenuPopup
          isOpen={contextMenu.isOpen}
          point={contextMenu.position}
          groups={createContextMenuGroups(contextMenuItems)}
          onClose={contextMenu.close}
        />
      </div>
    );
  },
);

GitHubActionsView.displayName = "GitHubActionsView";

export default GitHubActionsView;
