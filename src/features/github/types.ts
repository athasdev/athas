export interface PullRequestAuthor {
  login: string;
}

export interface StatusCheck {
  name: string;
  status: string;
  conclusion: string | null;
  workflowName: string;
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

export type PRFilter = "all" | "my-prs" | "review-requests";
