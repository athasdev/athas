export interface PullRequestAuthor {
  login: string;
  avatarUrl?: string | null;
}

export interface StatusCheck {
  name: string | null;
  status: string | null;
  conclusion: string | null;
  workflowName: string | null;
}

export interface LinkedIssue {
  number: number;
  url: string;
}

export interface Label {
  name: string;
  color: string;
}

export interface ReviewRequest {
  login: string;
  avatarUrl?: string | null;
}

export interface PullRequest {
  number: number;
  title: string;
  state: string;
  author: PullRequestAuthor;
  createdAt: string;
  updatedAt: string;
  isDraft: boolean;
  reviewDecision: string | null;
  url: string;
  headRef: string;
  baseRef: string;
  additions: number;
  deletions: number;
}

export interface PullRequestDetails {
  number: number;
  title: string;
  body: string;
  state: string;
  author: PullRequestAuthor;
  createdAt: string;
  updatedAt: string;
  isDraft: boolean;
  reviewDecision: string | null;
  url: string;
  headRef: string;
  baseRef: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  commits: unknown[];
  // Enhanced fields
  statusChecks: StatusCheck[];
  linkedIssues: LinkedIssue[];
  reviewRequests: ReviewRequest[];
  mergeStateStatus: string | null;
  mergeable: string | null;
  labels: Label[];
  assignees: PullRequestAuthor[];
}

export interface PullRequestFile {
  path: string;
  additions: number;
  deletions: number;
}

export interface PullRequestComment {
  author: PullRequestAuthor;
  body: string;
  createdAt: string;
}

export interface IssueListItem {
  number: number;
  title: string;
  state: string;
  author: PullRequestAuthor;
  updatedAt: string;
  url: string;
  labels: Label[];
}

export interface IssueComment {
  author: PullRequestAuthor;
  body: string;
  createdAt: string;
}

export interface IssueDetails {
  number: number;
  title: string;
  body: string;
  state: string;
  author: PullRequestAuthor;
  createdAt: string;
  updatedAt: string;
  url: string;
  labels: Label[];
  assignees: PullRequestAuthor[];
  comments: IssueComment[];
}

export interface WorkflowRunStep {
  name: string;
  status: string | null;
  conclusion: string | null;
  number?: number | null;
}

export interface WorkflowRunJob {
  name: string;
  status: string | null;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  url?: string | null;
  steps: WorkflowRunStep[];
}

export interface WorkflowRunDetails {
  databaseId: number;
  name: string | null;
  displayTitle: string | null;
  workflowName: string | null;
  event: string | null;
  status: string | null;
  conclusion: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  url: string;
  headBranch: string | null;
  headSha: string | null;
  jobs: WorkflowRunJob[];
}

export interface WorkflowRunListItem {
  databaseId: number;
  displayTitle: string | null;
  name: string | null;
  workflowName: string | null;
  event: string | null;
  status: string | null;
  conclusion: string | null;
  updatedAt: string | null;
  url: string;
  headBranch: string | null;
  headSha: string | null;
}

export type PRFilter = "all" | "my-prs" | "review-requests";
