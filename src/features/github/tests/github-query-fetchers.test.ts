import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { skipToken, type QueryClient } from "@tanstack/react-query";
import { commands } from "@/bindings/commands";
import { createQueryClient } from "@/utils/query-client";
import {
  githubKeys,
  issueDetailsQuery,
  issueListQuery,
  isGitHubAuthError,
  pullRequestCommentsQuery,
  pullRequestFilesQuery,
  pullRequestListQuery,
  repositoryMetadataQuery,
  storeIssueDetails,
  workflowRunDetailsQuery,
  workflowRunsQuery,
} from "../services/github-queries";

let client: QueryClient;

beforeEach(() => {
  client = createQueryClient({ queries: { retry: false } });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  client.clear();
  vi.restoreAllMocks();
});

describe("GitHub query fetchers", () => {
  it("loads a pull request's diff with its normalized file list", async () => {
    vi.spyOn(commands, "githubGetPrDiff").mockResolvedValue("diff --git a/a b/a");
    vi.spyOn(commands, "githubGetPrFiles").mockResolvedValue([
      { path: " a.ts ", additions: 1, deletions: 0 },
      { path: "" },
    ] as never);

    await expect(client.fetchQuery(pullRequestFilesQuery("/repo", 3))).resolves.toEqual({
      diff: "diff --git a/a b/a",
      files: [{ path: "a.ts", additions: 1, deletions: 0 }],
    });
  });

  it("loads pull request comments and issues", async () => {
    vi.spyOn(commands, "githubGetPrComments").mockResolvedValue([{ id: 1 }] as never);
    vi.spyOn(commands, "githubListIssues").mockResolvedValue([{ number: 2 }] as never);
    vi.spyOn(commands, "githubGetIssueDetails").mockResolvedValue({ number: 2 } as never);

    await expect(client.fetchQuery(pullRequestCommentsQuery("/repo", 3))).resolves.toEqual([
      { id: 1 },
    ]);
    await expect(client.fetchQuery(issueListQuery("/repo", "open" as never))).resolves.toEqual([
      { number: 2 },
    ]);
    await expect(client.fetchQuery(issueDetailsQuery("/repo", 2))).resolves.toEqual({ number: 2 });
    expect(commands.githubListIssues).toHaveBeenCalledWith("/repo", "open");
  });

  it("loads repository metadata and tolerates repositories without issue types", async () => {
    vi.spyOn(commands, "githubListLabels").mockResolvedValue([{ name: "bug" }] as never);
    vi.spyOn(commands, "githubListMilestones").mockResolvedValue([{ number: 1 }] as never);
    vi.spyOn(commands, "githubListIssueTypes").mockRejectedValue(new Error("404"));

    await expect(client.fetchQuery(repositoryMetadataQuery("/repo"))).resolves.toEqual({
      labels: [{ name: "bug" }],
      milestones: [{ number: 1 }],
      issueTypes: [],
    });
  });

  it("loads workflow runs and a run's details", async () => {
    vi.spyOn(commands, "githubListWorkflowRuns").mockResolvedValue([{ id: 5 }] as never);
    vi.spyOn(commands, "githubGetWorkflowRunDetails").mockResolvedValue({ id: 5 } as never);

    await expect(client.fetchQuery(workflowRunsQuery("/repo"))).resolves.toEqual([{ id: 5 }]);
    await expect(client.fetchQuery(workflowRunDetailsQuery("/repo", 5))).resolves.toEqual({
      id: 5,
    });
    expect(commands.githubGetWorkflowRunDetails).toHaveBeenCalledWith("/repo", 5);
  });

  it("does not fetch without a repository or run", () => {
    expect(pullRequestFilesQuery(null, 1).queryFn).toBe(skipToken);
    expect(pullRequestCommentsQuery(null, 1).queryFn).toBe(skipToken);
    expect(issueListQuery(null, "open" as never).queryFn).toBe(skipToken);
    expect(repositoryMetadataQuery(null).queryFn).toBe(skipToken);
    expect(workflowRunDetailsQuery("/repo", null).queryFn).toBe(skipToken);
  });

  it("reports credential failures from the pull request list", async () => {
    const onAuthError = vi.fn();
    vi.spyOn(commands, "githubListPrs")
      .mockRejectedValueOnce(new Error("HTTP 401: Bad credentials"))
      .mockRejectedValueOnce("network unreachable")
      .mockResolvedValueOnce([
        { number: 1, title: "x", headRefName: "a", baseRefName: "b" },
      ] as never);

    await expect(
      client.fetchQuery(pullRequestListQuery("/repo", "all", onAuthError)),
    ).rejects.toThrow("Bad credentials");
    client.clear();
    await expect(client.fetchQuery(pullRequestListQuery("/repo", "all", onAuthError))).rejects.toBe(
      "network unreachable",
    );
    client.clear();
    await expect(client.fetchQuery(pullRequestListQuery("/repo", "all"))).resolves.toEqual([
      expect.objectContaining({ headRef: "a", baseRef: "b" }),
    ]);

    expect(onAuthError).toHaveBeenCalledExactlyOnceWith("HTTP 401: Bad credentials");
  });

  it("recognizes auth failures by their message", () => {
    expect(isGitHubAuthError("403 Forbidden")).toBe(true);
    expect(isGitHubAuthError("token expired")).toBe(true);
    expect(isGitHubAuthError("rate limit exceeded")).toBe(false);
  });

  it("stores edited issue details and refreshes the issue lists", async () => {
    client.setQueryData(githubKeys.issueList("/repo", "open" as never), [{ number: 7 }]);

    await storeIssueDetails(client, "/repo", { number: 7, title: "Edited" } as never);

    expect(client.getQueryData(githubKeys.issue("/repo", 7))).toEqual({
      number: 7,
      title: "Edited",
    });
    expect(
      client.getQueryState(githubKeys.issueList("/repo", "open" as never))?.isInvalidated,
    ).toBe(true);
  });
});
