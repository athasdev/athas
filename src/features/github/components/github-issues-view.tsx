import { invoke } from "@tauri-apps/api/core";
import { WarningCircleIcon as AlertCircle, ChatCircleTextIcon as MessageSquare } from "@/ui/icons";
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
import type { IssueDetails, IssueFilter, IssueListItem } from "../types/github.types";
import { groupIssues } from "../utils/github-sidebar-groups";
import { getTimeAgo } from "../utils/github-viewer-utils";
import { GitHubAvatar } from "./github-avatar";
import { GitHubSidebarRow, type GitHubSidebarPreviewBadge } from "./github-sidebar-row";
import { GitHubSidebarSection } from "./github-sidebar-section";
import {
  GITHUB_ISSUE_DETAILS_TTL_MS,
  GITHUB_ISSUE_LIST_TTL_MS,
  githubIssueDetailsCache,
  githubIssueListCache,
} from "../utils/github-data-cache";
import { LoadingIndicator } from "@/ui/loading";

interface IssueListItemProps {
  issue: IssueListItem;
  isActive: boolean;
  onSelect: () => void;
  onPrefetch?: () => void;
  repoPath?: string | null;
}

const IssueRow = memo(({ issue, isActive, onSelect, onPrefetch, repoPath }: IssueListItemProps) => {
  const updatedLabel = getTimeAgo(issue.updatedAt);
  const labels = issue.labels.slice(0, 3);
  const isOpen = issue.state.toUpperCase() === "OPEN";
  const badges: GitHubSidebarPreviewBadge[] = [
    { label: issue.state, tone: isOpen ? "success" : "muted" },
    ...labels.map((label) => ({ label: label.name, tone: "default" as const })),
  ];
  const authorAvatar = (
    <GitHubAvatar
      login={issue.author.login}
      avatarUrl={issue.author.avatarUrl}
      size={40}
      className="size-full"
    />
  );

  return (
    <GitHubSidebarRow
      title={issue.title}
      onClick={onSelect}
      onPrefetch={onPrefetch}
      draggable
      onDragStart={(event) => {
        writeSidebarResourceDragData(event.dataTransfer, {
          type: "github-issue",
          repoPath: repoPath ?? undefined,
          number: issue.number,
          title: issue.title,
          authorAvatarUrl:
            issue.author.avatarUrl ||
            `https://github.com/${encodeURIComponent(issue.author.login || "github")}.png?size=32`,
          url: issue.url,
          name: `Issue #${issue.number}`,
        });
      }}
      active={isActive}
      leading={
        <MessageSquare className={isOpen ? "size-4 text-success" : "size-4 text-text-lighter"} />
      }
      description={
        <span className="flex min-w-0 items-center gap-1.5 capitalize">
          <span className="font-mono">#{issue.number}</span>
          <span aria-hidden="true">·</span>
          <span>{issue.state.toLowerCase()}</span>
          {labels[0] ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="truncate normal-case">{labels[0].name}</span>
            </>
          ) : null}
        </span>
      }
      trailing={
        <>
          <GitHubAvatar
            login={issue.author.login}
            avatarUrl={issue.author.avatarUrl}
            size={24}
            className="size-4"
          />
          <span>{updatedLabel}</span>
        </>
      }
      preview={{
        title: issue.title,
        subtitle: `#${issue.number} by ${issue.author.login}`,
        icon: authorAvatar,
        badges,
        details: [
          { label: "Updated", value: updatedLabel },
          { label: "Author", value: issue.author.login, mono: true },
          {
            label: "Labels",
            value: issue.labels.length
              ? issue.labels.map((label) => label.name).join(", ")
              : "None",
          },
          { label: "State", value: issue.state },
        ],
      }}
    />
  );
});

IssueRow.displayName = "IssueRow";

interface GitHubIssuesViewProps {
  refreshNonce?: number;
  searchQuery?: string;
  filter?: IssueFilter;
}

const GitHubIssuesView = memo(
  ({ refreshNonce = 0, searchQuery = "", filter = "open" }: GitHubIssuesViewProps) => {
    const rootFolderPath = useFileSystemStore.use.rootFolderPath?.();
    const activeRepoPath = useRepositoryStore.use.activeRepoPath();
    const repoPath = activeRepoPath ?? rootFolderPath ?? null;
    const { isAuthenticated } = useGitHubStore();
    const { checkAuth } = useGitHubStore().actions;
    const { openGitHubIssueBuffer } = useBufferStore.use.actions();
    const activeIssueNumber = useBufferStore((state) => {
      const activeBuffer = state.activeBufferId
        ? state.buffers.find((buffer) => buffer.id === state.activeBufferId)
        : null;
      return activeBuffer?.type === "githubIssue" ? activeBuffer.issueNumber : null;
    });
    const [issues, setIssues] = useState<IssueListItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const deferredIssues = useDeferredValue(issues);
    const deferredSearchQuery = useDeferredValue(searchQuery);

    const fetchIssues = useCallback(
      async (force = false) => {
        if (!repoPath) {
          setIssues([]);
          setError("No repository selected.");
          setIsLoading(false);
          return;
        }

        const cacheKey = `${repoPath}::${filter}`;
        const cached = githubIssueListCache.getFreshValue(cacheKey, GITHUB_ISSUE_LIST_TTL_MS);
        if (cached && !force) {
          startTransition(() => setIssues(cached));
          setError(null);
          setIsLoading(false);
          return;
        }

        const stale = githubIssueListCache.getSnapshot(cacheKey)?.value;
        if (stale && !force) {
          startTransition(() => setIssues(stale));
        }

        setIsLoading(true);
        setError(null);

        try {
          const nextIssues = await githubIssueListCache.load(
            cacheKey,
            () => invoke<IssueListItem[]>("github_list_issues", { repoPath, state: filter }),
            { force, ttlMs: GITHUB_ISSUE_LIST_TTL_MS },
          );
          startTransition(() => setIssues(nextIssues));
        } catch (nextError) {
          setError(nextError instanceof Error ? nextError.message : String(nextError));
        } finally {
          setIsLoading(false);
        }
      },
      [filter, repoPath],
    );

    const prefetchIssue = useCallback(
      (issue: IssueListItem) => {
        if (!repoPath) return;

        const cacheKey = `${repoPath}::${issue.number}`;
        void githubIssueDetailsCache
          .load(
            cacheKey,
            () =>
              invoke<IssueDetails>("github_get_issue_details", {
                repoPath,
                issueNumber: issue.number,
              }),
            { ttlMs: GITHUB_ISSUE_DETAILS_TTL_MS },
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
          void fetchIssues();
        }, 0);
      });

      return () => {
        window.cancelAnimationFrame(frameId);
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
        }
      };
    }, [fetchIssues, isAuthenticated]);

    useEffect(() => {
      if (isAuthenticated && refreshNonce > 0) {
        void fetchIssues(true);
      }
    }, [fetchIssues, isAuthenticated, refreshNonce]);

    const filteredIssues = useMemo(() => {
      const query = deferredSearchQuery.trim().toLowerCase();
      if (!query) return deferredIssues;

      return deferredIssues.filter((issue) =>
        [
          issue.title,
          `#${issue.number}`,
          issue.author.login,
          issue.state,
          ...issue.labels.map((label) => label.name),
        ].some((value) => value.toLowerCase().includes(query)),
      );
    }, [deferredIssues, deferredSearchQuery]);
    const groupedIssues = useMemo(
      () => groupIssues(filteredIssues, filter),
      [filter, filteredIssues],
    );
    const forceListSectionsExpanded = deferredSearchQuery.trim().length > 0;

    useEffect(() => {
      if (!isAuthenticated || !repoPath || filteredIssues.length === 0) return;

      let cancelled = false;
      const idleApi = window as Window & {
        requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
        cancelIdleCallback?: (id: number) => void;
      };
      const prefetchVisibleIssues = () => {
        if (cancelled) return;
        filteredIssues.slice(0, 4).forEach((issue) => prefetchIssue(issue));
      };
      const usesIdleCallback = typeof idleApi.requestIdleCallback === "function";
      const idleId = usesIdleCallback
        ? idleApi.requestIdleCallback?.(prefetchVisibleIssues, { timeout: 1200 })
        : window.setTimeout(prefetchVisibleIssues, 500);

      return () => {
        cancelled = true;
        if (usesIdleCallback && idleId !== undefined) {
          idleApi.cancelIdleCallback(idleId);
        } else if (idleId !== undefined) {
          window.clearTimeout(idleId);
        }
      };
    }, [filteredIssues, isAuthenticated, prefetchIssue, repoPath]);

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
          ) : isLoading && deferredIssues.length === 0 ? (
            <div className="flex items-center justify-center p-4">
              <LoadingIndicator label="Loading issues" showLabel compact />
            </div>
          ) : deferredIssues.length === 0 ? (
            <GitHubSidebarState icon={<MessageSquare className="size-4" />} title="No issues" />
          ) : filteredIssues.length === 0 ? (
            <GitHubSidebarState
              icon={<MessageSquare className="size-4" />}
              title="No matching issues"
            />
          ) : (
            <div className="space-y-1 overflow-x-hidden">
              {isLoading ? (
                <div className="flex items-center px-2 py-1.5">
                  <LoadingIndicator label="Refreshing" compact />
                </div>
              ) : null}
              {groupedIssues.map((group) => (
                <GitHubSidebarSection
                  key={group.id}
                  title={group.title}
                  count={group.items.length}
                  defaultExpanded={group.defaultExpanded}
                  forceExpanded={forceListSectionsExpanded}
                >
                  {group.items.map((issue) => (
                    <IssueRow
                      key={issue.number}
                      issue={issue}
                      isActive={activeIssueNumber === issue.number}
                      repoPath={repoPath}
                      onPrefetch={() => prefetchIssue(issue)}
                      onSelect={() =>
                        startTransition(() => {
                          openGitHubIssueBuffer({
                            issueNumber: issue.number,
                            repoPath: repoPath ?? undefined,
                            title: issue.title,
                            authorAvatarUrl:
                              issue.author.avatarUrl ||
                              `https://github.com/${encodeURIComponent(issue.author.login || "github")}.png?size=32`,
                            url: issue.url,
                          });
                        })
                      }
                    />
                  ))}
                </GitHubSidebarSection>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  },
);

GitHubIssuesView.displayName = "GitHubIssuesView";

export default GitHubIssuesView;
