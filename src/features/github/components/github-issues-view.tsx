import { invoke } from "@tauri-apps/api/core";
import {
  WarningCircle as AlertCircle,
  ChatCircleText as MessageSquare,
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
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { useRepositoryStore } from "@/features/git/stores/git-repository-store";
import { writeSidebarResourceDragData } from "@/features/sidebar-drag/sidebar-resource-drag";
import GitHubSidebarLoadingBar from "./github-sidebar-loading-bar";
import { useGitHubStore } from "../stores/github-store";
import type { IssueListItem } from "../types/github";
import { GITHUB_ISSUE_LIST_TTL_MS, githubIssueListCache } from "../utils/github-data-cache";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";

interface IssueListItemProps {
  issue: IssueListItem;
  isActive: boolean;
  onSelect: () => void;
  repoPath?: string | null;
}

const IssueRow = memo(({ issue, isActive, onSelect, repoPath }: IssueListItemProps) => (
  <Button
    onClick={onSelect}
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
    variant="ghost"
    size="sm"
    active={isActive}
    className={cn(
      "h-auto w-full min-w-0 cursor-grab items-start justify-start rounded-xl px-3 py-2.5 text-left transition-[transform,background-color,opacity] active:cursor-grabbing",
    )}
  >
    <img
      src={
        issue.author.avatarUrl ||
        `https://github.com/${encodeURIComponent(issue.author.login || "github")}.png?size=40`
      }
      alt={issue.author.login}
      className="size-5 shrink-0 self-start rounded-full bg-secondary-bg"
      loading="lazy"
    />
    <div className="min-w-0 flex-1">
      <div className="ui-text-sm truncate leading-4 text-text">{issue.title}</div>
      <div className="ui-text-sm mt-1 text-text-lighter">{`#${issue.number} by ${issue.author.login}`}</div>
    </div>
  </Button>
));

IssueRow.displayName = "IssueRow";

interface GitHubIssuesViewProps {
  refreshNonce?: number;
}

const GitHubIssuesView = memo(({ refreshNonce = 0 }: GitHubIssuesViewProps) => {
  const rootFolderPath = useFileSystemStore.use.rootFolderPath?.();
  const activeRepoPath = useRepositoryStore.use.activeRepoPath();
  const repoPath = activeRepoPath ?? rootFolderPath ?? null;
  const { isAuthenticated } = useGitHubStore();
  const { checkAuth } = useGitHubStore().actions;
  const { openGitHubIssueBuffer } = useBufferStore.use.actions();
  const buffers = useBufferStore.use.buffers();
  const activeBufferId = useBufferStore.use.activeBufferId();
  const activeIssueNumber = useMemo(() => {
    const activeBuffer = buffers.find((buffer) => buffer.id === activeBufferId);
    return activeBuffer?.type === "githubIssue" ? activeBuffer.issueNumber : null;
  }, [activeBufferId, buffers]);
  const [issues, setIssues] = useState<IssueListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deferredIssues = useDeferredValue(issues);

  const fetchIssues = useCallback(
    async (force = false) => {
      if (!repoPath) {
        setIssues([]);
        setError("No repository selected.");
        setIsLoading(false);
        return;
      }

      const cached = githubIssueListCache.getFreshValue(repoPath, GITHUB_ISSUE_LIST_TTL_MS);
      if (cached && !force) {
        startTransition(() => setIssues(cached));
        setError(null);
        setIsLoading(false);
        return;
      }

      const stale = githubIssueListCache.getSnapshot(repoPath)?.value;
      if (stale && !force) {
        startTransition(() => setIssues(stale));
      }

      setIsLoading(true);
      setError(null);

      try {
        const nextIssues = await githubIssueListCache.load(
          repoPath,
          () => invoke<IssueListItem[]>("github_list_issues", { repoPath }),
          { force, ttlMs: GITHUB_ISSUE_LIST_TTL_MS },
        );
        startTransition(() => setIssues(nextIssues));
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

  if (!isAuthenticated) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <GitHubAuthStatusMessage />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <GitHubSidebarLoadingBar isVisible={isLoading} className="mx-2 mb-1 mt-1" />
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        {error ? (
          <GitHubSidebarState
            icon={<AlertCircle className="size-4" />}
            title={error}
            tone="error"
          />
        ) : deferredIssues.length === 0 && !isLoading ? (
          <GitHubSidebarState icon={<MessageSquare className="size-4" />} title="No open issues" />
        ) : (
          <div className="space-y-1 overflow-x-hidden">
            {deferredIssues.map((issue) => (
              <IssueRow
                key={issue.number}
                issue={issue}
                isActive={activeIssueNumber === issue.number}
                repoPath={repoPath}
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
          </div>
        )}
      </div>
    </div>
  );
});

GitHubIssuesView.displayName = "GitHubIssuesView";

export default GitHubIssuesView;
