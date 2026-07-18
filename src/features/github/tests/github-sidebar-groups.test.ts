import { describe, expect, it } from "vite-plus/test";
import type { IssueListItem, PullRequest, WorkflowRunListItem } from "../types/github.types";
import { groupIssues, groupPullRequests, groupWorkflowRuns } from "../utils/github-sidebar-groups";

describe("GitHub sidebar groups", () => {
  it("separates open pull requests from drafts", () => {
    const pullRequests = [
      { number: 1, isDraft: false },
      { number: 2, isDraft: true },
    ] as PullRequest[];

    expect(groupPullRequests(pullRequests, "all").map((group) => group.title)).toEqual([
      "Open",
      "Drafts",
    ]);
  });

  it("keeps closed issues collapsed in the combined view", () => {
    const issues = [
      { number: 1, state: "OPEN" },
      { number: 2, state: "CLOSED" },
    ] as IssueListItem[];

    const groups = groupIssues(issues, "all");

    expect(groups.map((group) => group.title)).toEqual(["Open", "Closed"]);
    expect(groups.find((group) => group.id === "closed")?.defaultExpanded).toBe(false);
    expect(
      groupIssues(issues, "closed").find((group) => group.id === "closed")?.defaultExpanded,
    ).toBe(true);
  });

  it("groups workflow runs by actionable status", () => {
    const runs = [
      { databaseId: 1, status: "in_progress", conclusion: null },
      { databaseId: 2, status: "completed", conclusion: "failure" },
      { databaseId: 3, status: "completed", conclusion: "success" },
      { databaseId: 4, status: "completed", conclusion: "skipped" },
    ] as WorkflowRunListItem[];

    expect(groupWorkflowRuns(runs, "all").map((group) => group.title)).toEqual([
      "In progress",
      "Failed",
      "Successful",
      "Other",
    ]);
    expect(
      groupWorkflowRuns(runs, "successful").find((group) => group.id === "successful")
        ?.defaultExpanded,
    ).toBe(true);
  });
});
