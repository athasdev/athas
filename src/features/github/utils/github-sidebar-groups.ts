import type {
  IssueFilter,
  IssueListItem,
  PRFilter,
  PullRequest,
  WorkflowRunFilter,
  WorkflowRunListItem,
} from "../types/github.types";

export interface GitHubSidebarGroup<T> {
  id: string;
  title: string;
  items: T[];
  defaultExpanded: boolean;
}

export function groupPullRequests(
  pullRequests: PullRequest[],
  filter: PRFilter,
): GitHubSidebarGroup<PullRequest>[] {
  if (filter === "review-requests") {
    return createGroup("review", "Review requested", pullRequests);
  }

  return [
    ...createGroup(
      "open",
      "Open",
      pullRequests.filter((pullRequest) => !pullRequest.isDraft),
    ),
    ...createGroup(
      "drafts",
      "Drafts",
      pullRequests.filter((pullRequest) => pullRequest.isDraft),
    ),
  ];
}

export function groupIssues(
  issues: IssueListItem[],
  filter: IssueFilter,
): GitHubSidebarGroup<IssueListItem>[] {
  return [
    ...createGroup(
      "open",
      "Open",
      issues.filter((issue) => issue.state.toUpperCase() === "OPEN"),
    ),
    ...createGroup(
      "closed",
      "Closed",
      issues.filter((issue) => issue.state.toUpperCase() === "CLOSED"),
      filter !== "all",
    ),
  ];
}

export function groupWorkflowRuns(
  runs: WorkflowRunListItem[],
  filter: WorkflowRunFilter,
): GitHubSidebarGroup<WorkflowRunListItem>[] {
  const inProgress = runs.filter((run) => isWorkflowRunInProgress(run));
  const failed = runs.filter((run) => isWorkflowRunFailed(run));
  const successful = runs.filter((run) => run.conclusion?.toLowerCase() === "success");
  const groupedRunIds = new Set(
    [...inProgress, ...failed, ...successful].map((run) => run.databaseId),
  );

  return [
    ...createGroup("in-progress", "In progress", inProgress),
    ...createGroup("failed", "Failed", failed),
    ...createGroup("successful", "Successful", successful, filter !== "all"),
    ...createGroup(
      "other",
      "Other",
      runs.filter((run) => !groupedRunIds.has(run.databaseId)),
    ),
  ];
}

function createGroup<T>(
  id: string,
  title: string,
  items: T[],
  defaultExpanded = true,
): GitHubSidebarGroup<T>[] {
  return items.length > 0 ? [{ id, title, items, defaultExpanded }] : [];
}

function isWorkflowRunInProgress(run: WorkflowRunListItem): boolean {
  return ["queued", "pending", "in_progress", "waiting", "requested"].includes(
    run.status?.toLowerCase() ?? "",
  );
}

function isWorkflowRunFailed(run: WorkflowRunListItem): boolean {
  return ["failure", "cancelled", "timed_out", "startup_failure"].includes(
    run.conclusion?.toLowerCase() ?? "",
  );
}
