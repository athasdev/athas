import { describe, expect, it, vi } from "vite-plus/test";
import {
  createWorkflowRunNotifier,
  describeWorkflowRunChange,
} from "../services/github-workflow-notifications";
import type { WorkflowRunListItem } from "../types/github.types";
import type { ToastInput } from "@/features/notifications/types/notifications.types";

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

function createDependencies(overrides: { focused?: boolean; permission?: boolean } = {}) {
  return {
    isEnabled: () => true,
    showToast: vi.fn<(value: ToastInput) => string>(() => "toast"),
    record: vi.fn(),
    isAppFocused: vi.fn(async () => overrides.focused ?? false),
    isPermissionGranted: vi.fn(async () => overrides.permission ?? true),
    sendNative: vi.fn<(options: { title: string; body: string }) => void>(),
  };
}

describe("workflow run notifications", () => {
  it("describes starts and outcomes with workflow, branch, and duration", () => {
    const started = describeWorkflowRunChange({
      type: "started",
      run: run({ status: "in_progress", conclusion: null }),
      previous: null,
    });
    expect(started).toMatchObject({
      message: "CI started",
      description: "Add live sharing · main · #128",
      type: "info",
    });

    const failed = describeWorkflowRunChange({
      type: "completed",
      run: run({ runAttempt: 2 }),
      previous: null,
    });
    expect(failed).toMatchObject({
      message: "CI failed (attempt 2)",
      description: "Add live sharing · main · #128 · in 5m 00s",
      type: "error",
    });

    expect(
      describeWorkflowRunChange({
        type: "completed",
        run: run({ conclusion: "success" }),
        previous: null,
      }).message,
    ).toBe("CI passed");
  });

  it("records every change, toasts the first few, and notifies natively when unfocused", async () => {
    const dependencies = createDependencies();
    const notify = createWorkflowRunNotifier(dependencies);
    const openRun = vi.fn();
    const changes = [1, 2, 3, 4, 5].map((id) => ({
      type: "completed" as const,
      run: run({ databaseId: id, runNumber: id, conclusion: id === 3 ? "failure" : "success" }),
      previous: null,
    }));

    await notify(changes, openRun);

    expect(dependencies.record).toHaveBeenCalledTimes(5);
    expect(dependencies.record.mock.calls[0][0]).toMatchObject({ category: "github" });
    expect(dependencies.showToast).toHaveBeenCalledTimes(4);
    expect(dependencies.showToast.mock.calls[3][0].message).toBe("2 more workflow runs changed");
    expect(dependencies.sendNative).toHaveBeenCalledTimes(1);
    expect(dependencies.sendNative.mock.calls[0][0].title).toBe("CI failed");

    dependencies.showToast.mock.calls[0][0].action?.onClick();
    expect(openRun).toHaveBeenCalledWith(changes[0].run);
  });

  it("stays quiet natively while the app is focused", async () => {
    const dependencies = createDependencies({ focused: true });
    const notify = createWorkflowRunNotifier(dependencies);

    await notify(
      [{ type: "started", run: run({ status: "in_progress", conclusion: null }), previous: null }],
      vi.fn(),
    );

    expect(dependencies.showToast).toHaveBeenCalledTimes(1);
    expect(dependencies.sendNative).not.toHaveBeenCalled();
  });
});
