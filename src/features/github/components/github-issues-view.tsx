import { invoke } from "@tauri-apps/api/core";
import { AlertCircle, MessageSquare, RefreshCw } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { useRepositoryStore } from "@/features/git/stores/git-repository-store";
import { useGitHubStore } from "../stores/github-store";
import type { IssueListItem } from "../types/github";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";

const ISSUE_LIST_CACHE_TTL_MS = 30_000;
const issueListCache = new Map<string, { fetchedAt: number; issues: IssueListItem[] }>();

interface IssueListItemProps {
  issue: IssueListItem;
  isActive: boolean;
  onSelect: () => void;
}

const IssueRow = memo(({ issue, isActive, onSelect }: IssueListItemProps) => (
  <Button
    onClick={onSelect}
    variant="ghost"
    size="sm"
    active={isActive}
    className={cn("h-auto w-full items-start justify-start rounded-xl px-3 py-2.5 text-left")}
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

const GitHubIssuesView = memo(() => {
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

  const fetchIssues = useCallback(
    async (force = false) => {
      if (!repoPath) {
        setIssues([]);
        setError("No repository selected.");
        setIsLoading(false);
        return;
      }

      const cached = issueListCache.get(repoPath);
      if (cached && !force && Date.now() - cached.fetchedAt < ISSUE_LIST_CACHE_TTL_MS) {
        setIssues(cached.issues);
        setError(null);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const nextIssues = await invoke<IssueListItem[]>("github_list_issues", { repoPath });
        issueListCache.set(repoPath, { fetchedAt: Date.now(), issues: nextIssues });
        setIssues(nextIssues);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : String(nextError));
      } finally {
        setIsLoading(false);
      }
    },
    [repoPath],
  );

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (isAuthenticated) {
      void fetchIssues();
    }
  }, [fetchIssues, isAuthenticated]);

  if (!isAuthenticated) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center">
        <div className="space-y-2">
          <AlertCircle className="mx-auto text-text-lighter" />
          <p className="ui-text-sm text-text">GitHub CLI not authenticated</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="ui-text-sm text-text">Issues</div>
        <Button onClick={() => void fetchIssues(true)} variant="ghost" size="icon-xs" aria-label="Refresh issues">
          <RefreshCw className={cn(isLoading && "animate-spin")} />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {error ? (
          <div className="flex items-center gap-2 px-2 py-3 text-error">
            <AlertCircle className="size-4" />
            <p className="ui-text-sm">{error}</p>
          </div>
        ) : issues.length === 0 && !isLoading ? (
          <div className="flex items-center gap-2 px-2 py-3 text-text-lighter">
            <MessageSquare className="size-4" />
            <p className="ui-text-sm">No open issues</p>
          </div>
        ) : (
          <div className="space-y-1">
            {issues.map((issue) => (
              <IssueRow
                key={issue.number}
                issue={issue}
                isActive={activeIssueNumber === issue.number}
                onSelect={() =>
                  openGitHubIssueBuffer({
                    issueNumber: issue.number,
                    repoPath: repoPath ?? undefined,
                    title: issue.title,
                    authorAvatarUrl:
                      issue.author.avatarUrl ||
                      `https://github.com/${encodeURIComponent(issue.author.login || "github")}.png?size=32`,
                    url: issue.url,
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
