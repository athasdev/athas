import { useEffect, useMemo, useState } from "react";
import { commands } from "@/bindings/commands";
import { SearchMatchHighlight } from "@/components/search-match-highlight";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useRepositoryStore } from "@/features/git/stores/git-repository.store";
import { useGitHubStore } from "@/features/github/stores/github.store";
import type { IssueListItem } from "@/features/github/types/github.types";
import { getGitHubAvatarUrl } from "@/features/github/utils/github-avatar-url";
import {
  GITHUB_ISSUE_LIST_TTL_MS,
  githubIssueListCache,
} from "@/features/github/utils/github-data-cache";
import { CommandEmpty, CommandItemBadge } from "@/ui/command";
import { CircleDotIcon, GitPullRequestIcon } from "@/ui/icons";
import { matchesSearchQuery } from "@/utils/search-match";
import type {
  QuickOpenItem,
  QuickOpenSectionInput,
  QuickOpenSectionResult,
} from "../types/quick-open.types";

const ISSUE_FILTER = "open";

/** Open pull requests and issues of the repository, from the same caches as the GitHub views. */
export function useGitHubSection({
  query,
  isActive,
  close,
}: QuickOpenSectionInput): QuickOpenSectionResult {
  const activeRepoPath = useRepositoryStore.use.activeRepoPath();
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
  const repoPath = activeRepoPath ?? rootFolderPath ?? null;
  const isAuthenticated = useGitHubStore.use.isAuthenticated();
  const isCheckingAuth = useGitHubStore.use.isCheckingAuth();
  const prs = useGitHubStore.use.prs();
  const prRepoPath = useGitHubStore.use.activeRepoPath();
  const isLoadingPRs = useGitHubStore.use.isLoading();
  const issueKey = repoPath ? `${repoPath}::${ISSUE_FILTER}` : null;
  const [issues, setIssues] = useState<{ key: string | null; items: IssueListItem[] }>({
    key: null,
    items: [],
  });

  useEffect(() => {
    if (!isActive) return;
    void useGitHubStore.getState().actions.checkAuth();
  }, [isActive]);

  useEffect(() => {
    if (!isActive || !isAuthenticated || !repoPath || !issueKey) return;
    let cancelled = false;
    void useGitHubStore.getState().actions.fetchPRs(repoPath);
    const cached = githubIssueListCache.getSnapshot(issueKey)?.value;
    if (cached) setIssues({ key: issueKey, items: cached });
    void githubIssueListCache
      .load(issueKey, () => commands.githubListIssues(repoPath, ISSUE_FILTER), {
        ttlMs: GITHUB_ISSUE_LIST_TTL_MS,
      })
      .then((items) => {
        if (!cancelled) setIssues({ key: issueKey, items });
      })
      .catch(() => {
        if (!cancelled) setIssues({ key: issueKey, items: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [isActive, isAuthenticated, issueKey, repoPath]);

  const items = useMemo((): QuickOpenItem[] => {
    if (!repoPath) return [];
    const pullRequests = (prRepoPath === repoPath ? prs : [])
      .filter((pr) =>
        matchesSearchQuery(query, [pr.title, `#${pr.number}`, pr.author.login, pr.headRef]),
      )
      .map((pr): QuickOpenItem => ({
        key: `pr:${pr.number}`,
        group: "Pull requests",
        icon: (
          <GitPullRequestIcon className={pr.isDraft ? "text-muted-foreground" : "text-success"} />
        ),
        title: <SearchMatchHighlight text={pr.title} query={query} />,
        description: `${pr.author.login} · ${pr.headRef} → ${pr.baseRef}`,
        accessory: (
          <>
            {pr.isDraft ? <CommandItemBadge>Draft</CommandItemBadge> : null}
            <CommandItemBadge>#{pr.number}</CommandItemBadge>
          </>
        ),
        select: () => {
          close();
          useBufferStore.getState().actions.openPRBuffer(pr.number, {
            title: pr.title,
            repoPath,
            authorAvatarUrl: getGitHubAvatarUrl(pr.author),
          });
        },
      }));
    const issueItems = (issues.key === issueKey ? issues.items : [])
      .filter((issue) =>
        matchesSearchQuery(query, [
          issue.title,
          `#${issue.number}`,
          issue.author.login,
          ...issue.labels.map((label) => label.name),
        ]),
      )
      .map((issue): QuickOpenItem => ({
        key: `issue:${issue.number}`,
        group: "Issues",
        icon: <CircleDotIcon className="text-success" />,
        title: <SearchMatchHighlight text={issue.title} query={query} />,
        description: [issue.author.login, ...issue.labels.map((label) => label.name)].join(" · "),
        accessory: <CommandItemBadge>#{issue.number}</CommandItemBadge>,
        select: () => {
          close();
          useBufferStore.getState().actions.openGitHubIssueBuffer({
            issueNumber: issue.number,
            repoPath,
            title: issue.title,
            authorAvatarUrl: getGitHubAvatarUrl(issue.author),
            url: issue.url,
          });
        },
      }));
    return [...pullRequests, ...issueItems];
  }, [close, issueKey, issues, prRepoPath, prs, query, repoPath]);

  const isLoading =
    isActive && (isCheckingAuth || (isAuthenticated && (isLoadingPRs || issues.key !== issueKey)));

  return {
    items,
    isLoading,
    empty: (
      <CommandEmpty>
        {!repoPath
          ? "Open a folder with a GitHub repository"
          : !isAuthenticated && !isCheckingAuth
            ? "Sign in to GitHub to search pull requests and issues"
            : isLoading
              ? "Loading pull requests and issues..."
              : query
                ? "No matching pull requests or issues"
                : "No open pull requests or issues"}
      </CommandEmpty>
    ),
  };
}
