import { describe, expect, it } from "vite-plus/test";
import type { WorkflowRunListItem } from "../types/github.types";
import { diffWorkflowRuns } from "../utils/github-workflow-run-changes";

const now = new Date("2026-09-06T23:30:00Z").getTime();

const run = (overrides: Partial<WorkflowRunListItem>): WorkflowRunListItem => ({
  databaseId: 1,
  displayTitle: "Add live sharing",
  name: "CI",
  workflowName: "CI",
  event: "push",
  status: "completed",
  conclusion: "success",
  createdAt: "2026-09-06T23:20:00Z",
  updatedAt: "2026-09-06T23:26:00Z",
  runStartedAt: "2026-09-06T23:21:00Z",
  runNumber: 10,
  runAttempt: 1,
  workflowId: 5,
  actor: null,
  headCommitMessage: null,
  url: "https://github.com/athasdev/athas/actions/runs/1",
  headBranch: "main",
  headSha: "bb423c6",
  ...overrides,
});

describe("workflow run change detection", () => {
  it("reports nothing on the first poll", () => {
    expect(diffWorkflowRuns(null, [run({ status: "in_progress", conclusion: null })])).toEqual([]);
  });

  it("notices runs that start, finish, or both between polls", () => {
    const previous = [
      run({ databaseId: 1, status: "in_progress", conclusion: null }),
      run({ databaseId: 2, status: "completed", conclusion: "success" }),
    ];
    const next = [
      run({ databaseId: 1, status: "completed", conclusion: "failure" }),
      run({ databaseId: 2, status: "completed", conclusion: "success" }),
      run({ databaseId: 3, status: "queued", conclusion: null }),
      run({
        databaseId: 4,
        status: "completed",
        conclusion: "success",
        updatedAt: "2026-09-06T23:29:00Z",
      }),
      run({
        databaseId: 5,
        status: "completed",
        conclusion: "success",
        updatedAt: "2026-09-06T20:00:00Z",
      }),
    ];

    const changes = diffWorkflowRuns(previous, next, { now });

    expect(changes.map((change) => [change.type, change.run.databaseId])).toEqual([
      ["completed", 1],
      ["started", 3],
      ["completed", 4],
    ]);
    expect(changes[0].previous?.status).toBe("in_progress");
  });

  it("treats a new attempt of a finished run as a fresh start", () => {
    const previous = [run({ databaseId: 1, status: "completed", conclusion: "failure" })];
    const next = [run({ databaseId: 1, status: "in_progress", conclusion: null, runAttempt: 2 })];

    expect(diffWorkflowRuns(previous, next, { now })).toMatchObject([{ type: "started" }]);
  });
});
