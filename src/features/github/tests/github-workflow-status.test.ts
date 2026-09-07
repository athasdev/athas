import { describe, expect, it } from "vite-plus/test";
import type { WorkflowRunJob } from "../types/github.types";
import {
  formatWorkflowDuration,
  getWorkflowRunState,
  getWorkflowRunTiming,
  pickInitialWorkflowJob,
  pickInitialWorkflowStepIndex,
  summarizeWorkflowJobs,
} from "../utils/github-workflow-status";

const job = (overrides: Partial<WorkflowRunJob>): WorkflowRunJob => ({
  id: 1,
  name: "job",
  status: "completed",
  conclusion: "success",
  startedAt: null,
  completedAt: null,
  labels: [],
  steps: [],
  ...overrides,
});

describe("workflow run status", () => {
  it("maps conclusions before statuses", () => {
    expect(getWorkflowRunState("completed", "success")).toMatchObject({
      phase: "success",
      tone: "success",
      isActive: false,
    });
    expect(getWorkflowRunState("completed", "timed_out")).toMatchObject({
      phase: "failure",
      label: "Timed out",
      isFailed: true,
    });
    expect(getWorkflowRunState("in_progress", null)).toMatchObject({
      phase: "running",
      isActive: true,
    });
    expect(getWorkflowRunState("queued", null)).toMatchObject({ phase: "queued", isActive: true });
    expect(getWorkflowRunState("waiting", null)).toMatchObject({
      phase: "waiting",
      tone: "warning",
    });
    expect(getWorkflowRunState("completed", "action_required").label).toBe("Action required");
    expect(getWorkflowRunState(null, null).label).toBe("Unknown");
  });

  it("formats durations at the right granularity", () => {
    expect(formatWorkflowDuration(4_000)).toBe("4s");
    expect(formatWorkflowDuration(288_000)).toBe("4m 48s");
    expect(formatWorkflowDuration(3_900_000)).toBe("1h 05m");
    expect(formatWorkflowDuration(null)).toBeNull();
  });

  it("keeps active runs ticking against the current time", () => {
    const now = new Date("2026-09-06T23:26:00Z").getTime();
    const running = getWorkflowRunTiming(
      {
        status: "in_progress",
        conclusion: null,
        runStartedAt: "2026-09-06T23:21:00Z",
        createdAt: "2026-09-06T23:20:00Z",
        updatedAt: "2026-09-06T23:22:00Z",
      },
      now,
    );
    expect(running).toMatchObject({ isLive: true, durationMs: 300_000 });

    const finished = getWorkflowRunTiming(
      {
        status: "completed",
        conclusion: "failure",
        runStartedAt: "2026-09-06T23:21:00Z",
        createdAt: null,
        updatedAt: "2026-09-06T23:26:00Z",
      },
      now,
    );
    expect(finished).toMatchObject({ isLive: false, durationMs: 300_000 });
  });

  it("summarises jobs and picks the most useful selection", () => {
    const jobs = [
      job({ id: 1, name: "lint", conclusion: "success" }),
      job({
        id: 2,
        name: "test",
        conclusion: "failure",
        steps: [
          { name: "Set up job", status: "completed", conclusion: "success" },
          { name: "Run tests", status: "completed", conclusion: "failure" },
        ],
      }),
      job({ id: 3, name: "build", status: "in_progress", conclusion: null }),
      job({ id: 4, name: "deploy", conclusion: "skipped" }),
    ];

    expect(summarizeWorkflowJobs(jobs)).toMatchObject({
      total: 4,
      succeeded: 1,
      failed: 1,
      running: 1,
      skipped: 1,
      completed: 3,
    });
    expect(pickInitialWorkflowJob(jobs)?.id).toBe(2);
    expect(pickInitialWorkflowStepIndex(jobs[1].steps)).toBe(1);
    expect(pickInitialWorkflowJob([jobs[0], jobs[2]])?.id).toBe(3);
    expect(pickInitialWorkflowStepIndex([])).toBeNull();
  });
});
