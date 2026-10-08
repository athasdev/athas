import { queryOptions, skipToken, type QueryClient } from "@tanstack/react-query";
import { commands } from "@/bindings/commands";
import { fetchWorkflowRunDetails } from "../api/github-actions-api";
import {
  fetchIssueDetails,
  listIssues,
  listRepositoryIssueTypes,
  listRepositoryLabels,
  listRepositoryMilestones,
} from "../api/github-issues-api";
import type {
  IssueDetails,
  IssueFilter,
  IssueMilestone,
  IssueType,
  Label,
  PRFilter,
  PullRequestComment,
  PullRequestFile,
} from "../types/github.types";
import {
  fetchNormalizedPRDetails,
  normalizePullRequest,
  normalizePullRequestFiles,
} from "./github-pr-store-service";

/**
 * Query keys for GitHub data. Everything repository-scoped starts with `["github", repoPath]`, so
 * one prefix invalidates a repository, and a pull request's files and comments sit under its
 * details key.
 */
export const githubKeys = {
  all: ["github"] as const,
  pullRequests: (repoPath: string | null) => ["github", repoPath, "prs"] as const,
  pullRequestList: (repoPath: string | null, filter: PRFilter) =>
    ["github", repoPath, "prs", filter] as const,
  pullRequest: (repoPath: string | null, prNumber: number) =>
    ["github", repoPath, "pr", prNumber] as const,
  pullRequestFiles: (repoPath: string | null, prNumber: number) =>
    ["github", repoPath, "pr", prNumber, "files"] as const,
  pullRequestComments: (repoPath: string | null, prNumber: number) =>
    ["github", repoPath, "pr", prNumber, "comments"] as const,
  issues: (repoPath: string | null) => ["github", repoPath, "issues"] as const,
  issueList: (repoPath: string | null, filter: IssueFilter) =>
    ["github", repoPath, "issues", filter] as const,
  issue: (repoPath: string | null, issueNumber: number) =>
    ["github", repoPath, "issue", issueNumber] as const,
  metadata: (repoPath: string | null) => ["github", repoPath, "meta"] as const,
  workflowRuns: (repoPath: string | null) => ["github", repoPath, "runs"] as const,
  workflowRun: (repoPath: string | null, runId: number | null) =>
    ["github", repoPath, "run", runId] as const,
  notificationsRoot: ["github", "notifications"] as const,
  notifications: (login: string | null) => ["github", "notifications", login] as const,
};

const PR_LIST_STALE_MS = 5 * 60_000;
const PR_DETAILS_STALE_MS = 2 * 60_000;
const ISSUE_LIST_STALE_MS = 60_000;
const ISSUE_DETAILS_STALE_MS = 5 * 60_000;
const REPOSITORY_METADATA_STALE_MS = 10 * 60_000;
const WORKFLOW_RUNS_STALE_MS = 15_000;
const WORKFLOW_RUN_DETAILS_STALE_MS = 15_000;
export const GITHUB_NOTIFICATIONS_INTERVAL_MS = 60_000;

export interface PullRequestFilesData {
  diff: string;
  files: PullRequestFile[];
}

export interface RepositoryMetadata {
  labels: Label[];
  milestones: IssueMilestone[];
  issueTypes: IssueType[];
}

const AUTH_ERROR_PATTERN = /unauthorized|forbidden|401|403|credential|auth|token/i;

export function isGitHubAuthError(message: string) {
  return AUTH_ERROR_PATTERN.test(message);
}

async function fetchPullRequestFiles(
  repoPath: string,
  prNumber: number,
): Promise<PullRequestFilesData> {
  const [diff, files] = await Promise.all([
    commands.githubGetPrDiff(repoPath, prNumber),
    commands.githubGetPrFiles(repoPath, prNumber),
  ]);
  return { diff, files: normalizePullRequestFiles(files) };
}

function fetchPullRequestComments(
  repoPath: string,
  prNumber: number,
): Promise<PullRequestComment[]> {
  return commands.githubGetPrComments(repoPath, prNumber);
}

async function fetchRepositoryMetadata(repoPath: string): Promise<RepositoryMetadata> {
  const [labels, milestones, issueTypes] = await Promise.all([
    listRepositoryLabels(repoPath),
    listRepositoryMilestones(repoPath),
    // Issue types exist only for organization repositories; elsewhere GitHub answers 404.
    listRepositoryIssueTypes(repoPath).catch((): IssueType[] => []),
  ]);
  return { labels, milestones, issueTypes };
}

export function pullRequestListQuery(
  repoPath: string | null,
  filter: PRFilter,
  onAuthError?: (message: string) => void,
) {
  return queryOptions({
    queryKey: githubKeys.pullRequestList(repoPath, filter),
    queryFn: repoPath
      ? async () => {
          try {
            const pullRequests = await commands.githubListPrs(repoPath, filter);
            return pullRequests.map(normalizePullRequest);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (onAuthError && isGitHubAuthError(message)) onAuthError(message);
            throw error;
          }
        }
      : skipToken,
    staleTime: PR_LIST_STALE_MS,
  });
}

export function pullRequestDetailsQuery(repoPath: string | null, prNumber: number) {
  return queryOptions({
    queryKey: githubKeys.pullRequest(repoPath, prNumber),
    queryFn: repoPath ? () => fetchNormalizedPRDetails(repoPath, prNumber) : skipToken,
    staleTime: PR_DETAILS_STALE_MS,
  });
}

export function pullRequestFilesQuery(repoPath: string | null, prNumber: number) {
  return queryOptions({
    queryKey: githubKeys.pullRequestFiles(repoPath, prNumber),
    queryFn: repoPath ? () => fetchPullRequestFiles(repoPath, prNumber) : skipToken,
    staleTime: PR_DETAILS_STALE_MS,
  });
}

export function pullRequestCommentsQuery(repoPath: string | null, prNumber: number) {
  return queryOptions({
    queryKey: githubKeys.pullRequestComments(repoPath, prNumber),
    queryFn: repoPath ? () => fetchPullRequestComments(repoPath, prNumber) : skipToken,
    staleTime: PR_DETAILS_STALE_MS,
  });
}

export function issueListQuery(repoPath: string | null, filter: IssueFilter) {
  return queryOptions({
    queryKey: githubKeys.issueList(repoPath, filter),
    queryFn: repoPath ? () => listIssues(repoPath, filter) : skipToken,
    staleTime: ISSUE_LIST_STALE_MS,
  });
}

export function issueDetailsQuery(repoPath: string | null, issueNumber: number) {
  return queryOptions({
    queryKey: githubKeys.issue(repoPath, issueNumber),
    queryFn: repoPath ? () => fetchIssueDetails(repoPath, issueNumber) : skipToken,
    staleTime: ISSUE_DETAILS_STALE_MS,
  });
}

/**
 * Keep an issue's edited details and refresh the issue lists that show it: their titles, labels
 * and states can all change with an edit.
 */
export function storeIssueDetails(client: QueryClient, repoPath: string, details: IssueDetails) {
  client.setQueryData(githubKeys.issue(repoPath, details.number), details);
  return client.invalidateQueries({ queryKey: githubKeys.issues(repoPath) });
}

/** Labels, milestones and issue types, shared by every issue, pull request and form of a repo. */
export function repositoryMetadataQuery(repoPath: string | null) {
  return queryOptions({
    queryKey: githubKeys.metadata(repoPath),
    queryFn: repoPath ? () => fetchRepositoryMetadata(repoPath) : skipToken,
    staleTime: REPOSITORY_METADATA_STALE_MS,
  });
}

export function workflowRunsQuery(repoPath: string | null) {
  return queryOptions({
    queryKey: githubKeys.workflowRuns(repoPath),
    queryFn: repoPath ? () => commands.githubListWorkflowRuns(repoPath) : skipToken,
    staleTime: WORKFLOW_RUNS_STALE_MS,
  });
}

export function workflowRunDetailsQuery(repoPath: string | null, runId: number | null) {
  return queryOptions({
    queryKey: githubKeys.workflowRun(repoPath, runId),
    queryFn:
      repoPath && runId !== null ? () => fetchWorkflowRunDetails(repoPath, runId) : skipToken,
    staleTime: WORKFLOW_RUN_DETAILS_STALE_MS,
  });
}

export function notificationsQuery(login: string | null) {
  return queryOptions({
    queryKey: githubKeys.notifications(login),
    queryFn: login ? () => commands.githubListNotifications() : skipToken,
    staleTime: GITHUB_NOTIFICATIONS_INTERVAL_MS,
  });
}
