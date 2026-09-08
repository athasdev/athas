import { describe, expect, it } from "vite-plus/test";
import type { IssueListItem, PullRequest, WorkflowRunListItem } from "../types/github.types";
import { groupIssues, groupPullRequests, groupWorkflowRuns } from "../utils/github-sidebar-groups";

describe("GitHub sidebar groups", () => {
  it("separates open pull requests from drafts", () => {
    const prs = [
      { number: 1, isDraft: false },
      { number: 2, isDraft: true },
    ] as PullRequest[];
    expect(groupPullRequests(prs, "all").map((group) => group.title)).toEqual(["Open", "Drafts"]);
    expect(groupPullRequests(prs, "review-requests")[0].items).toEqual(prs);
  });
  it("keeps both open and closed issues visible", () => {
    const issues = [
      { number: 1, state: "OPEN" },
      { number: 2, state: "CLOSED" },
    ] as IssueListItem[];
    expect(groupIssues(issues).map((group) => group.title)).toEqual(["Open", "Closed"]);
    expect(groupIssues(issues).flatMap((group) => group.items)).toEqual(issues);
  });
  it("groups runs by calendar day, newest first, regardless of workflow or status", () => {
    const runs = [
      {
        databaseId: 1,
        createdAt: "2026-09-06T10:00:00",
        status: "in_progress",
        workflowName: "CI",
      },
      {
        databaseId: 2,
        createdAt: "2026-09-08T10:00:00",
        status: "completed",
        workflowName: "Release",
      },
      { databaseId: 3, createdAt: "2026-09-08T11:00:00", status: "completed", workflowName: "CI" },
      { databaseId: 4, createdAt: "invalid", status: "completed" },
    ] as WorkflowRunListItem[];
    const groups = groupWorkflowRuns(runs);
    expect(groups.map((group) => group.items.map((run) => run.databaseId))).toEqual([
      [3, 2],
      [1],
      [4],
    ]);
    expect(groups[groups.length - 1]?.title).toBe("Unknown");
    expect(runs.map((run) => run.databaseId)).toEqual([1, 2, 3, 4]);
    expect(groupWorkflowRuns([])).toEqual([]);
  });
  it("separates adjacent local calendar days", () => {
    const runs = [
      { databaseId: 1, createdAt: "2026-09-07T23:59:00" },
      { databaseId: 2, createdAt: "2026-09-08T00:01:00" },
    ] as WorkflowRunListItem[];
    expect(
      groupWorkflowRuns(runs).map((group) => group.items.map((run) => run.databaseId)),
    ).toEqual([[2], [1]]);
  });
});
