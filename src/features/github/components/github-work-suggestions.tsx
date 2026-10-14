import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { ChatBubbleTextIcon, GitPullRequestIcon } from "@/ui/icons";
import { Item, ItemContent, ItemGroup, ItemMedia } from "@/ui/item";
import { issueListQuery, pullRequestListQuery } from "../services/github-queries";
import { useGitHubStore } from "../stores/github.store";
import type { IssueListItem, PullRequest } from "../types/github.types";
import {
  type GitHubWorkItem,
  selectGitHubWorkSuggestions,
} from "../services/github-work-suggestions";

const EMPTY_PULL_REQUESTS: PullRequest[] = [];
const EMPTY_ISSUES: IssueListItem[] = [];

interface GitHubWorkSuggestionsProps {
  repoPath: string | null;
  onStart: (item: GitHubWorkItem) => void;
}

/**
 * The repository's latest open pull requests and issues, offered as starting points for an
 * agent. Shows nothing until GitHub answers, and nothing at all when it cannot.
 */
export function GitHubWorkSuggestions({ repoPath, onStart }: GitHubWorkSuggestionsProps) {
  const isAuthenticated = useGitHubStore.use.isAuthenticated();
  const { checkAuth } = useGitHubStore.use.actions();
  const enabled = isAuthenticated && Boolean(repoPath);
  const pullRequests = useQuery({ ...pullRequestListQuery(repoPath, "all"), enabled });
  const issues = useQuery({ ...issueListQuery(repoPath, "open"), enabled });

  useEffect(() => {
    if (repoPath) void checkAuth();
  }, [checkAuth, repoPath]);

  const items = useMemo(
    () =>
      selectGitHubWorkSuggestions(
        pullRequests.data ?? EMPTY_PULL_REQUESTS,
        issues.data ?? EMPTY_ISSUES,
      ),
    [issues.data, pullRequests.data],
  );

  if (!enabled || items.length === 0) return null;

  return (
    <section
      className="flex w-full flex-col gap-1"
      aria-label="Suggested from GitHub"
      data-slot="github-work-suggestions"
    >
      <h2 className="px-2 text-left font-normal text-subtle-foreground ui-text-sm">
        Pick up from GitHub
      </h2>
      <ItemGroup>
        {items.map((item) => (
          <Item
            key={`${item.kind}-${item.number}`}
            render={<button type="button" />}
            size="compact"
            className="text-left"
            title={item.url}
            aria-label={`Start an agent on ${
              item.kind === "pull-request" ? "pull request" : "issue"
            } #${item.number}: ${item.title}`}
            onClick={() => onStart(item)}
          >
            <ItemMedia variant="icon">
              {item.kind === "pull-request" ? <GitPullRequestIcon /> : <ChatBubbleTextIcon />}
            </ItemMedia>
            <ItemContent>
              <span className="truncate text-muted-foreground">{item.title}</span>
            </ItemContent>
            <span className="shrink-0 tabular-nums text-subtle-foreground ui-text-sm">
              #{item.number}
            </span>
          </Item>
        ))}
      </ItemGroup>
    </section>
  );
}
