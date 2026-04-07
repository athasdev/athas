import { invoke } from "@tauri-apps/api/core";
import { AlertCircle, MessageSquare } from "lucide-react";
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
import type { IssueListItem } from "../types/github";
import {
  GITHUB_ISSUE_DETAILS_TTL_MS,
  GITHUB_ISSUE_LIST_TTL_MS,
  githubIssueDetailsCache,
  githubIssueListCache,
} from "../utils/github-data-cache";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";

interface IssueListItemProps {
  issue: IssueListItem;
  isActive: boolean;
  onSelect: () => void;
  onPrefetch: () => void;
}

const IssueRow = memo(({ issue, isActive, onSelect, onPrefetch }: IssueListItemProps) => (
  <Button
    onClick={onSelect}
    onMouseEnter={onPrefetch}
    onFocus={onPrefetch}
    variant="ghost"
    size="sm"
    active={isActive}
    className={cn(
      "h-auto w-full min-w-0 items-start justify-start rounded-xl px-3 py-2.5 text-left",
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

        // Warm a few likely-next issue details so opening is near-instant.
        for (const issue of nextIssues.slice(0, 3)) {
          const cacheKey = `${repoPath}::${issue.number}`;
          void githubIssueDetailsCache.load(
            cacheKey,
            () => invoke("github_get_issue_details", { repoPath, issueNumber: issue.number }),
            { ttlMs: GITHUB_ISSUE_DETAILS_TTL_MS },
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
        ) : deferredIssues.length === 0 && !isLoading ? (
          <div className="flex items-center gap-2 px-2 py-3 text-text-lighter">
            <MessageSquare className="size-4" />
            <p className="ui-text-sm">No open issues</p>
          </div>
        ) : (
          <div className="space-y-1 overflow-x-hidden">
            {deferredIssues.map((issue) => (
              <IssueRow
                key={issue.number}
                issue={issue}
                isActive={activeIssueNumber === issue.number}
                onPrefetch={() => {
                  if (!repoPath) return;
                  const cacheKey = `${repoPath}::${issue.number}`;
                  void githubIssueDetailsCache.load(
                    cacheKey,
                    () =>
                      invoke("github_get_issue_details", { repoPath, issueNumber: issue.number }),
                    { ttlMs: GITHUB_ISSUE_DETAILS_TTL_MS },
                  );
                }}
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
