interface PullRequestAuthor {
  login: string;
  avatarUrl?: string | null;
}

export interface StatusCheck {
  id?: number | null;
  name: string | null;
  status: string | null;
  conclusion: string | null;
  workflowName: string | null;
  detailsUrl?: string | null;
}

export interface LinkedIssue {
  number: number;
  url: string;
}

export interface Label {
  name: string;
  color: string;
}

interface ReviewRequest {
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

export interface GitHubNotification {
  id: string;
  title: string;
  subjectType: string;
  reason: string;
  unread: boolean;
  updatedAt: string;
  lastReadAt: string | null;
  repositoryFullName: string;
  url: string;
  subjectUrl: string;
}

export interface IssueComment {
  id: number;
  author: PullRequestAuthor;
  body: string;
  createdAt: string;
  updatedAt: string;
  url: string;
}

export interface IssueMilestone {
  number: number;
  title: string;
  state: string;
  dueOn: string | null;
}

export interface IssueType {
  id: number;
  name: string;
  description: string | null;
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
  stateReason: string | null;
  locked: boolean;
  activeLockReason: string | null;
  milestone: IssueMilestone | null;
  issueType: IssueType | null;
  closedAt: string | null;
  closedBy: PullRequestAuthor | null;
  comments: IssueComment[];
}

export interface WorkflowRunStep {
  name: string;
  status: string | null;
  conclusion: string | null;
  number?: number | null;
}

export interface WorkflowRunJob {
  id?: number | null;
  name: string;
  status: string | null;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  url?: string | null;
  runnerName?: string | null;
  labels: string[];
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

export interface WorkflowListItem {
  id: number;
  name: string;
  path: string;
  state: string;
}

export type PRFilter = "all" | "my-prs" | "review-requests";
export type IssueFilter = "open" | "closed" | "all";
export type WorkflowRunFilter = "all" | "in-progress" | "successful" | "failed";
