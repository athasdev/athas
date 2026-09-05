import { useGitHubList } from "../hooks/use-github-list";
import { invoke } from "@tauri-apps/api/core";
import { GitHubAuthStatusMessage } from "./github-auth-status";
import { memo, startTransition, useCallback, useDeferredValue, useEffect, useMemo } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useRepositoryStore } from "@/features/git/stores/git-repository.store";
import { writeSidebarResourceDragData } from "@/features/sidebar/utils/sidebar-resource-drag";
import { useGitHubStore } from "../stores/github.store";
import type { IssueDetails, IssueFilter, IssueListItem } from "../types/github.types";
import { groupIssues } from "../utils/github-sidebar-groups";
import { getTimeAgo } from "../utils/github-viewer-utils";
import { getGitHubAvatarUrl } from "../utils/github-avatar-url";
import { GitHubAvatar } from "./github-avatar";
import { GitHubSidebarRow, type GitHubSidebarPreviewBadge } from "./github-sidebar-row";
import { SidebarScrollArea, SidebarSection } from "@/ui/sidebar";
import {
  GITHUB_ISSUE_DETAILS_TTL_MS,
  GITHUB_ISSUE_LIST_TTL_MS,
  githubIssueDetailsCache,
  githubIssueListCache,
} from "../utils/github-data-cache";
import { Spinner } from "@/ui/spinner";
import { EmptyState } from "@/ui/empty";

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
          authorAvatarUrl: getGitHubAvatarUrl(issue.author),
          url: issue.url,
          name: `Issue #${issue.number}`,
        });
      }}
      active={isActive}
      leading={authorAvatar}
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
      trailing={updatedLabel}
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
    const isAuthenticated = useGitHubStore.use.isAuthenticated();
    const { checkAuth } = useGitHubStore.use.actions();
    const { openGitHubIssueBuffer } = useBufferStore.use.actions();
    const activeIssueNumber = useBufferStore((state) => {
      const activeBuffer = state.activeBufferId
        ? state.buffers.find((buffer) => buffer.id === state.activeBufferId)
        : null;
      return activeBuffer?.type === "githubIssue" ? activeBuffer.issueNumber : null;
    });
    const load = useCallback(
      () => invoke<IssueListItem[]>("github_list_issues", { repoPath, state: filter }),
      [filter, repoPath],
    );
    const {
      data: deferredIssues,
      isLoading,
      error,
      refresh,
    } = useGitHubList({
      cache: githubIssueListCache,
      cacheKey: repoPath ? `${repoPath}::${filter}` : null,
      enabled: isAuthenticated,
      load,
      refreshNonce,
      ttlMs: GITHUB_ISSUE_LIST_TTL_MS,
    });
    const deferredSearchQuery = useDeferredValue(searchQuery);

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
      return <GitHubAuthStatusMessage layout="sidebar" />;
    }

    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-busy={isLoading}>
        <SidebarScrollArea className="min-h-0 flex-1">
          {error && (
            <EmptyState
              layout="sidebar"
              message={error}
              tone="error"
              role="alert"
              action={{ label: "Retry", onClick: refresh, disabled: isLoading }}
            />
          )}
          {isLoading && deferredIssues.length === 0 ? (
            <EmptyState
              layout="sidebar"
              message={<Spinner label="Loading issues" showLabel compact />}
            />
          ) : error && deferredIssues.length === 0 ? null : deferredIssues.length === 0 ? (
            <EmptyState layout="sidebar" message="No issues" />
          ) : filteredIssues.length === 0 ? (
            <EmptyState layout="sidebar" message="No matching issues" />
          ) : (
            <div className="space-y-1 overflow-x-hidden">
              {groupedIssues.map((group) => (
                <SidebarSection
                  key={group.id}
                  title={group.title}
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
                            authorAvatarUrl: getGitHubAvatarUrl(issue.author),
                            url: issue.url,
                          });
                        })
                      }
                    />
                  ))}
                </SidebarSection>
              ))}
            </div>
          )}
        </SidebarScrollArea>
      </div>
    );
  },
);

GitHubIssuesView.displayName = "GitHubIssuesView";

export default GitHubIssuesView;
