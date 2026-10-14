import type { IssueListItem, PullRequest } from "../types/github.types";

/** An open pull request or issue that an agent can be started on. */
export type GitHubWorkItem =
  | {
      kind: "pull-request";
      number: number;
      title: string;
      url: string;
      updatedAt: string;
      headRef: string;
      baseRef: string;
    }
  | { kind: "issue"; number: number; title: string; url: string; updatedAt: string };

const DEFAULT_LIMIT = 2;

const isOpen = (state: string) => state.toUpperCase() === "OPEN";
const byRecentUpdate = (left: { updatedAt: string }, right: { updatedAt: string }) =>
  Date.parse(right.updatedAt) - Date.parse(left.updatedAt);

/** The most recently updated open pull requests, then issues, a few of each. */
export function selectGitHubWorkSuggestions(
  pullRequests: readonly PullRequest[],
  issues: readonly IssueListItem[],
  limit = DEFAULT_LIMIT,
): GitHubWorkItem[] {
  const openPullRequests = pullRequests
    .filter((pullRequest) => isOpen(pullRequest.state))
    .sort(byRecentUpdate)
    .slice(0, limit)
    .map((pullRequest): GitHubWorkItem => ({
      kind: "pull-request",
      number: pullRequest.number,
      title: pullRequest.title,
      url: pullRequest.url,
      updatedAt: pullRequest.updatedAt,
      headRef: pullRequest.headRef,
      baseRef: pullRequest.baseRef,
    }));
  const openIssues = issues
    .filter((issue) => isOpen(issue.state))
    .sort(byRecentUpdate)
    .slice(0, limit)
    .map((issue): GitHubWorkItem => ({
      kind: "issue",
      number: issue.number,
      title: issue.title,
      url: issue.url,
      updatedAt: issue.updatedAt,
    }));
  return [...openPullRequests, ...openIssues];
}
