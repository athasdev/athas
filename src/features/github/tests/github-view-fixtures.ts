import type {
  PullRequest,
  PullRequestDetails,
  WorkflowRunDetails,
  WorkflowRunListItem,
} from "../types/github.types";

export const pullRequest = (number: number, extra: Partial<PullRequest> = {}): PullRequest => ({
  number,
  title: `Pull request ${number}`,
  state: "OPEN",
  author: { login: number % 2 ? "ada" : "linus" },
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-10T00:00:00Z",
  isDraft: false,
  reviewDecision: null,
  url: `https://github.com/athasdev/athas/pull/${number}`,
  headRef: `feature-${number}`,
  baseRef: "main",
  additions: number * 10,
  deletions: number,
  ...extra,
});

export const pullRequestDetails = (
  number: number,
  extra: Partial<PullRequestDetails> = {},
): PullRequestDetails =>
  ({
    ...pullRequest(number),
    body: "Fixes the **parser**.",
    changedFiles: 2,
    commits: [
      {
        oid: "a28ec85000000000000000000000000000000000",
        messageHeadline: "Rework parser",
        messageBody: "",
        authoredDate: "2026-10-02T00:00:00Z",
        authors: [{ login: "ada", name: "Ada", email: "ada@example.com" }],
      },
    ],
    statusChecks: [{ name: "build", status: "COMPLETED", conclusion: "SUCCESS" }],
    linkedIssues: [],
    reviewRequests: [],
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    mergedAt: null,
    mergedBy: null,
    closedAt: null,
    reviews: [],
    labels: [{ name: "bug", color: "d73a4a" }],
    assignees: [],
    ...extra,
  }) as unknown as PullRequestDetails;

export const workflowRun = (
  databaseId: number,
  extra: Partial<WorkflowRunListItem> = {},
): WorkflowRunListItem => ({
  databaseId,
  displayTitle: `Run ${databaseId}`,
  name: "CI",
  workflowName: "CI",
  event: "push",
  status: "completed",
  conclusion: "success",
  createdAt: "2026-10-10T00:00:00Z",
  updatedAt: "2026-10-10T00:05:00Z",
  runStartedAt: "2026-10-10T00:00:00Z",
  runNumber: databaseId,
  runAttempt: 1,
  workflowId: 7,
  actor: { login: "ada" },
  headCommitMessage: `Commit for run ${databaseId}`,
  url: `https://github.com/athasdev/athas/actions/runs/${databaseId}`,
  headBranch: "main",
  headSha: "abcdef1234567890",
  ...extra,
});

export const workflowRunDetails = (
  databaseId: number,
  extra: Partial<WorkflowRunDetails> = {},
): WorkflowRunDetails => ({
  ...workflowRun(databaseId),
  jobs: [],
  ...extra,
});
