import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { SearchMatchHighlight } from "@/components/search-match-highlight";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useRepositoryStore } from "@/features/git/stores/git-repository.store";
import { useGitHubStore } from "@/features/github/stores/github.store";
import type { IssueFilter } from "@/features/github/types/github.types";
import { getGitHubAvatarUrl } from "@/features/github/services/github-avatar-url";
import { issueListQuery, pullRequestListQuery } from "@/features/github/services/github-queries";
import { CommandEmpty, CommandItemBadge } from "@/ui/command";
import { CircleDotIcon, GitPullRequestIcon } from "@/ui/icons";
import { matchesSearchQuery } from "@/utils/search-match";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import type {
  QuickOpenItem,
  QuickOpenSectionInput,
  QuickOpenSectionResult,
} from "../types/quick-open.types";

const ISSUE_FILTER: IssueFilter = "open";

/** Open pull requests and issues of the repository, from the same queries as the GitHub views. */
export function useGitHubSection({
  query,
  isActive,
  close,
}: QuickOpenSectionInput): QuickOpenSectionResult {
  const activeRepoPath = useRepositoryStore.use.activeRepoPath();
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  const repoPath = activeRepoPath ?? rootFolderPath ?? null;
  const isAuthenticated = useGitHubStore.use.isAuthenticated();
  const isCheckingAuth = useGitHubStore.use.isCheckingAuth();
  const currentFilter = useGitHubStore.use.currentFilter();
  const { markAuthFailed } = useGitHubStore.use.actions();
  const isEnabled = isActive && isAuthenticated && !!repoPath;
  const pullRequestsQuery = useQuery({
    ...pullRequestListQuery(repoPath, currentFilter, markAuthFailed),
    enabled: isEnabled,
  });
  const issuesQuery = useQuery({ ...issueListQuery(repoPath, ISSUE_FILTER), enabled: isEnabled });
  const prs = pullRequestsQuery.data;
  const issues = issuesQuery.data;

  useEffect(() => {
    if (!isActive) return;
    void useGitHubStore.getState().actions.checkAuth();
  }, [isActive]);

  const items = useMemo((): QuickOpenItem[] => {
    if (!repoPath) return [];
    const pullRequests = (prs ?? [])
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
    const issueItems = (issues ?? [])
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
  }, [close, issues, prs, query, repoPath]);

  const isLoading =
    isActive &&
    (isCheckingAuth || (isEnabled && (pullRequestsQuery.isPending || issuesQuery.isPending)));

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
