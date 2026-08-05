import { describe, expect, it } from "vite-plus/test";
import type { IssueDetails, Label, PullRequestDetails } from "../types/github.types";
import {
  type GitHubResourceInvoker,
  loadGitHubEditableResource,
} from "../utils/github-editable-resource";

const selectedLabel: Label = { name: "bug", color: "ff0000" };
const repositoryLabel: Label = { name: "feature", color: "00ff00" };

function createInvoker(
  details: IssueDetails | PullRequestDetails,
  calls: Array<{ command: string; args?: Record<string, unknown> }>,
): GitHubResourceInvoker {
  return async <T>(command: string, args?: Record<string, unknown>) => {
    calls.push({ command, args });
    if (command === "github_list_labels") return [repositoryLabel] as T;
    if (command === "github_list_milestones") return [] as T;
    if (command === "github_list_issue_types") return [] as T;
    return details as T;
  };
}

describe("GitHub editable resource loading", () => {
  it("loads authoritative issue details and preserves selected metadata", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const details = {
      title: "full issue title",
      body: "full issue body",
      labels: [selectedLabel],
      assignees: [{ login: "octocat" }],
    } as IssueDetails;

    const resource = await loadGitHubEditableResource(
      { repoPath: "/repo", resourceNumber: 42, kind: "issue" },
      createInvoker(details, calls),
    );

    expect(calls[0]).toEqual({
      command: "github_get_issue_details",
      args: { repoPath: "/repo", issueNumber: 42 },
    });
    expect(resource).toEqual({
      title: "full issue title",
      body: "full issue body",
      labels: [repositoryLabel, selectedLabel],
      selectedLabelNames: ["bug"],
      assignees: ["octocat"],
      milestones: [],
      issueTypes: [],
      milestone: null,
      issueType: null,
    });
  });

  it("uses the full pull request details endpoint", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const details = {
      title: "full pull request title",
      body: "full pull request body",
      labels: [],
      assignees: [],
    } as unknown as PullRequestDetails;

    await loadGitHubEditableResource(
      { repoPath: "/repo", resourceNumber: 7, kind: "pull-request" },
      createInvoker(details, calls),
    );

    expect(calls[0]).toEqual({
      command: "github_get_pr_details",
      args: { repoPath: "/repo", prNumber: 7 },
    });
  });
});
