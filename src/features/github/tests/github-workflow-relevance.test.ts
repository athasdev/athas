import { describe, expect, it, vi } from "vite-plus/test";
import type { WorkflowRunListItem } from "../types/github.types";
import { filterRelevantWorkflowChanges } from "../utils/github-workflow-relevance";
import type { WorkflowRunChange } from "../utils/github-workflow-run-changes";

const run = (overrides: Partial<WorkflowRunListItem>): WorkflowRunListItem => ({
  databaseId: 128,
  displayTitle: "Add live sharing",
  name: "CI",
  workflowName: "CI",
  event: "push",
  status: "completed",
  conclusion: "failure",
  createdAt: "2026-09-06T23:20:00Z",
  updatedAt: "2026-09-06T23:26:00Z",
  runStartedAt: "2026-09-06T23:21:00Z",
  runNumber: 128,
  runAttempt: 1,
  workflowId: 5,
  actor: null,
  headCommitMessage: null,
  url: "https://github.com/athasdev/athas/actions/runs/128",
  headBranch: "main",
  headSha: "bb423c6",
  ...overrides,
});

const change = (overrides: Partial<WorkflowRunListItem> = {}): WorkflowRunChange => ({
  type: "completed",
  run: run(overrides),
  previous: null,
});
const participants = () => ({
  author: { login: "someone-else" },
  assignees: [] as { login: string }[],
  reviewRequests: [] as { login: string }[],
});

describe("workflow notification relevance", () => {
  it("ignores repository-wide runs from other people and bots", async () => {
    const load = vi.fn();
    expect(
      await filterRelevantWorkflowChanges([change({ actor: { login: "bot" } })], "me", load),
    ).toEqual([]);
    expect(load).not.toHaveBeenCalled();
  });

  it.each(["actor", "triggeringActor"] as const)(
    "includes runs started by the viewer through %s",
    async (key) => {
      const updates = [change({ [key]: { login: "Me" } })];
      expect(await filterRelevantWorkflowChanges(updates, "me", vi.fn())).toEqual(updates);
    },
  );

  it.each(["author", "assignees", "reviewRequests"] as const)(
    "includes related PRs through %s",
    async (role) => {
      const pr = participants();
      if (role === "author") pr.author = { login: "me" };
      else pr[role] = [{ login: "me" }];
      const updates = [change({ pullRequestNumbers: [42] })];
      expect(await filterRelevantWorkflowChanges(updates, "me", async () => pr)).toEqual(updates);
    },
  );

  it("checks each PR once and excludes unrelated changes", async () => {
    const load = vi.fn(async () => participants());
    const updates = [
      change({ pullRequestNumbers: [42] }),
      change({ databaseId: 129, pullRequestNumbers: [42] }),
    ];
    expect(await filterRelevantWorkflowChanges(updates, "me", load)).toEqual([]);
    expect(load).toHaveBeenCalledExactlyOnceWith(42);
  });

  it("stays quiet when identity or PR access cannot be verified", async () => {
    const updates = [change({ pullRequestNumbers: [42] })];
    const load = vi.fn(async () => {
      throw new Error("Not available");
    });
    expect(await filterRelevantWorkflowChanges(updates, null, load)).toEqual([]);
    expect(load).not.toHaveBeenCalled();
    expect(await filterRelevantWorkflowChanges(updates, "me", load)).toEqual([]);
  });
});
