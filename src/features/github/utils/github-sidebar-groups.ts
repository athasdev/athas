import type {
  IssueListItem,
  PRFilter,
  PullRequest,
  WorkflowRunListItem,
} from "../types/github.types";
import { formatCalendarDateGroup } from "@/utils/date";

export interface GitHubSidebarGroup<T> {
  id: string;
  title: string;
  items: T[];
}

export function groupPullRequests(
  pullRequests: PullRequest[],
  filter: PRFilter,
): GitHubSidebarGroup<PullRequest>[] {
  if (filter === "review-requests") return createGroup("review", "Review requested", pullRequests);
  return [
    ...createGroup(
      "open",
      "Open",
      pullRequests.filter((pr) => !pr.isDraft),
    ),
    ...createGroup(
      "drafts",
      "Drafts",
      pullRequests.filter((pr) => pr.isDraft),
    ),
  ];
}

export function groupIssues(issues: IssueListItem[]): GitHubSidebarGroup<IssueListItem>[] {
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
    ),
  ];
}

export function groupByDate<T>(items: T[], getDate: (item: T) => string): GitHubSidebarGroup<T>[] {
  const timestamp = (item: T) => {
    const value = new Date(getDate(item)).getTime();
    return Number.isNaN(value) ? -Infinity : value;
  };
  const groups = new Map<string, GitHubSidebarGroup<T>>();
  for (const item of [...items].sort((a, b) => timestamp(b) - timestamp(a))) {
    const date = new Date(getDate(item));
    const id = Number.isNaN(date.getTime())
      ? "unknown"
      : `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const group = groups.get(id) ?? { id, title: formatCalendarDateGroup(date), items: [] };
    group.items.push(item);
    groups.set(id, group);
  }
  return [...groups.values()];
}

export function groupWorkflowRuns(
  runs: WorkflowRunListItem[],
): GitHubSidebarGroup<WorkflowRunListItem>[] {
  return groupByDate(runs, (run) => run.createdAt ?? run.updatedAt ?? "");
}

function createGroup<T>(id: string, title: string, items: T[]): GitHubSidebarGroup<T>[] {
  return items.length ? [{ id, title, items }] : [];
}
