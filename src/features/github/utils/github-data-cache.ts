import type {
  IssueDetails,
  IssueListItem,
  WorkflowRunDetails,
  WorkflowRunListItem,
} from "../types/github";
import { createTimedResourceCache } from "./github-resource-cache";

export const GITHUB_ISSUE_LIST_TTL_MS = 60_000;
export const GITHUB_ISSUE_DETAILS_TTL_MS = 5 * 60_000;
export const GITHUB_ACTION_LIST_TTL_MS = 60_000;
export const GITHUB_ACTION_DETAILS_TTL_MS = 5 * 60_000;

export const githubIssueListCache = createTimedResourceCache<IssueListItem[]>();
export const githubIssueDetailsCache = createTimedResourceCache<IssueDetails>();
export const githubActionListCache = createTimedResourceCache<WorkflowRunListItem[]>();
export const githubActionDetailsCache = createTimedResourceCache<WorkflowRunDetails>();
