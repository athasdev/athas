// @vitest-environment jsdom
import { fireEvent, within } from "@testing-library/dom";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { createTestQueryClient } from "@/utils/tests/query-test-client";
import type { WorkflowRunJob } from "../types/github.types";
import { workflowRun, workflowRunDetails } from "./github-view-fixtures";

vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: () => Promise.resolve(null),
      transformCallback: () => 1,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
    __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
  });
});

const mocks = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  openExternalUrl: vi.fn(async () => {}),
  saveTextFile: vi.fn(),
  openCommitDiff: vi.fn(async (): Promise<string | null> => "commit-buffer"),
  clipboard: [] as string[],
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/utils/external-url", () => ({ openExternalUrl: mocks.openExternalUrl }));
vi.mock("@/utils/file-dialogs", () => ({ saveTextFileWithDialog: mocks.saveTextFile }));
vi.mock("@/utils/clipboard", () => ({
  writeClipboardText: async (text: string) => {
    mocks.clipboard.push(text);
  },
}));
vi.mock("@/features/git/services/open-commit-diff-buffer", () => ({
  openCommitDiffBuffer: mocks.openCommitDiff,
}));
vi.mock("@/features/editor/components/codemirror-readonly-view", () => ({
  CodeMirrorReadonlyView: () => <div data-log-editor />,
}));
vi.mock("../lib/github-workflow-log-codemirror", () => ({
  workflowLogExtension: [],
  updateWorkflowLog: vi.fn(),
}));
vi.mock("@/features/editor/stores/buffer.store", async () => {
  const { create } = await import("zustand");
  const { createSelectors } = await import("@/utils/zustand-selectors");
  type Buffer = { id: string } & Record<string, unknown>;
  const store = create<{ buffers: Buffer[]; actions: Record<string, unknown> }>()((set) => ({
    buffers: [],
    actions: {
      updateBuffer: (next: Buffer) =>
        set((state) => ({
          buffers: state.buffers.map((buffer) => (buffer.id === next.id ? next : buffer)),
        })),
    },
  }));
  return { useBufferStore: createSelectors(store) };
});

const { default: GitHubActionViewer } = await import("../components/github-action-viewer");
const { useBufferStore } = await import("@/features/editor/stores/buffer.store");
const { githubKeys } = await import("../services/github-queries");

const mockInvoke = vi.mocked(invoke);
type Handler = (args: Record<string, any>) => unknown;
let handlers: Record<string, Handler>;

function calls(command: string) {
  return mockInvoke.mock.calls
    .filter(([name]) => name === command)
    .map(([, args]) => args as Record<string, unknown> | undefined);
}

const job = (id: number, extra: Partial<WorkflowRunJob> = {}): WorkflowRunJob => ({
  id,
  name: `job-${id}`,
  status: "completed",
  conclusion: "success",
  startedAt: "2026-10-10T00:00:00Z",
  completedAt: "2026-10-10T00:02:00Z",
  url: `https://github.com/athasdev/athas/actions/runs/55/job/${id}`,
  labels: [],
  steps: [],
  ...extra,
});

const FAILED_RUN = workflowRunDetails(55, {
  displayTitle: "Nightly tests",
  headCommitMessage: "Speed up the parser",
  conclusion: "failure",
  runAttempt: 2,
  jobs: [
    job(1, {
      name: "build",
      conclusion: "failure",
      steps: [
        { name: "Set up job", status: "completed", conclusion: "success", number: 1 },
        { name: "Run tests", status: "completed", conclusion: "failure", number: 2 },
      ],
    }),
    job(2, { name: "lint" }),
  ],
});

const LOG = [
  "2026-10-10T00:00:01.0000000Z ##[group]Run tests",
  "2026-10-10T00:00:02.0000000Z running 3 tests",
  "2026-10-10T00:00:03.0000000Z ##[error]test parser failed",
  "2026-10-10T00:00:04.0000000Z ##[endgroup]",
].join("\n");

let client: QueryClient;
let root: Root;
let host: HTMLDivElement;

async function settle() {
  await act(async () => {
    for (let index = 0; index < 10; index++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render(props: { runId?: number; notification?: object; repoPath?: string } = {}) {
  useBufferStore.setState({
    buffers: [
      { id: "action-buffer", type: "githubAction", name: "Run", runId: props.runId },
    ] as never,
  });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <GitHubActionViewer
          bufferId="action-buffer"
          repoPath={"repoPath" in props ? props.repoPath : "/repo"}
          runId={"runId" in props ? props.runId : 55}
          notification={props.notification as never}
        />
      </QueryClientProvider>,
    ),
  );
  await settle();
}

const view = () => within(host);

async function click(element: Element) {
  await act(async () => {
    (element as HTMLElement).click();
  });
  await settle();
}

function menuItem(label: string) {
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (element) => element.textContent?.trim() === label,
  );
  if (!item) throw new Error(`menu item ${label} not found`);
  return item;
}

async function chooseRunAction(label: string) {
  await click(view().getByRole("button", { name: "Action run actions" }));
  await click(menuItem(label));
}

const jobButton = (name: string) =>
  within(view().getByRole("navigation", { name: "Workflow jobs" }))
    .getAllByRole("button")
    .find((button) => button.textContent?.includes(name)) as HTMLElement;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  workspaceRuntimeRegistry.resetForTests();
  for (const fn of [...Object.values(mocks.toast), mocks.openExternalUrl, mocks.saveTextFile]) {
    fn.mockReset();
  }
  mocks.openCommitDiff.mockReset();
  mocks.openCommitDiff.mockResolvedValue("commit-buffer");
  mocks.clipboard = [];
  handlers = {
    github_get_workflow_run_details: () => FAILED_RUN,
    github_get_workflow_job_logs: () => LOG,
    github_rerun_workflow_run: () => null,
    github_cancel_workflow_run: () => null,
    github_list_workflow_runs: () => [workflowRun(55)],
  };
  mockInvoke.mockReset();
  mockInvoke.mockImplementation(async (command, args) => {
    const handler = handlers[command];
    return handler ? handler((args ?? {}) as Record<string, any>) : null;
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  Element.prototype.getAnimations = () => [];
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  client = createTestQueryClient();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  client.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GitHub action run viewer", () => {
  it("summarizes a failed run and loads the failing job's log", async () => {
    await render();

    expect(view().getByText("Nightly tests")).toBeTruthy();
    expect(view().getByText("Speed up the parser")).toBeTruthy();
    expect(view().getByText("Attempt 2")).toBeTruthy();
    expect(view().getByText("1 of 2 jobs failed")).toBeTruthy();
    expect(view().getByText("1 passed")).toBeTruthy();
    expect(calls("github_get_workflow_job_logs")).toEqual([{ repoPath: "/repo", jobId: 1 }]);
    expect(useBufferStore.getState().buffers[0]).toMatchObject({
      name: "Nightly tests",
      url: "https://github.com/athasdev/athas/actions/runs/55",
    });
  });

  it("loads another job's log when it is selected", async () => {
    await render();

    await click(jobButton("lint"));

    expect(calls("github_get_workflow_job_logs")).toEqual([
      { repoPath: "/repo", jobId: 1 },
      { repoPath: "/repo", jobId: 2 },
    ]);
  });

  it("shows a failed job log and retries it", async () => {
    let attempts = 0;
    handlers.github_get_workflow_job_logs = () => {
      attempts += 1;
      if (attempts === 1) throw new Error("logs expired");
      return LOG;
    };
    await render();

    expect(view().getByText("logs expired")).toBeTruthy();
    await click(view().getByRole("button", { name: "Retry" }));
    expect(view().queryByText("logs expired")).toBeNull();
  });

  it("re-runs failed or all jobs of a failed run", async () => {
    await render();

    await click(view().getByRole("button", { name: /Re-run/ }));
    await click(menuItem("Re-run failed jobs"));
    expect(calls("github_rerun_workflow_run")).toEqual([
      { repoPath: "/repo", runId: 55, failedJobsOnly: true },
    ]);
    expect(mocks.toast.success).toHaveBeenCalledWith("Re-run of failed jobs queued");

    await click(view().getByRole("button", { name: /Re-run/ }));
    await click(menuItem("Re-run all jobs"));
    expect(calls("github_rerun_workflow_run").slice(-1)[0]).toEqual({
      repoPath: "/repo",
      runId: 55,
      failedJobsOnly: false,
    });

    handlers.github_rerun_workflow_run = () => {
      throw new Error("run too old");
    };
    await click(view().getByRole("button", { name: /Re-run/ }));
    await click(menuItem("Re-run all jobs"));
    expect(mocks.toast.error).toHaveBeenCalledWith("run too old");
  });

  it("re-runs a successful run with one click", async () => {
    handlers.github_get_workflow_run_details = () =>
      workflowRunDetails(55, { jobs: [job(2, { name: "lint" })] });
    await render();

    expect(view().getByText("1 of 1 jobs passed")).toBeTruthy();
    await click(view().getByRole("button", { name: "Re-run" }));

    expect(calls("github_rerun_workflow_run")).toEqual([
      { repoPath: "/repo", runId: 55, failedJobsOnly: false },
    ]);
    expect(mocks.toast.success).toHaveBeenCalledWith("Re-run queued");
  });

  it("cancels a running run", async () => {
    handlers.github_get_workflow_run_details = () =>
      workflowRunDetails(55, {
        status: "in_progress",
        conclusion: null,
        jobs: [
          job(1, { status: "in_progress", conclusion: null, completedAt: null }),
          job(2, { status: "queued", conclusion: null, startedAt: null, completedAt: null }),
          job(3),
        ],
      });
    await render();

    expect(view().getByText("1 of 3 jobs finished")).toBeTruthy();
    expect(view().getByText("1 running")).toBeTruthy();
    expect(view().getByText("1 queued")).toBeTruthy();
    expect(view().queryByRole("button", { name: /Re-run/ })).toBeNull();
    await click(view().getByRole("button", { name: "Cancel" }));

    expect(calls("github_cancel_workflow_run")).toEqual([{ repoPath: "/repo", runId: 55 }]);
    expect(mocks.toast.success).toHaveBeenCalledWith("Cancellation requested");
  });

  it("waits for queued jobs before loading logs", async () => {
    handlers.github_get_workflow_run_details = () =>
      workflowRunDetails(55, {
        status: "queued",
        conclusion: null,
        jobs: [job(4, { status: "queued", conclusion: null, startedAt: null, completedAt: null })],
      });
    await render();

    expect(view().getByText("Logs become available once this job starts running")).toBeTruthy();
    expect(calls("github_get_workflow_job_logs")).toEqual([]);
  });

  it("copies, refreshes and opens the run", async () => {
    await render();

    await chooseRunAction("Copy link");
    await chooseRunAction("Copy commit SHA");
    expect(mocks.clipboard).toEqual([
      "https://github.com/athasdev/athas/actions/runs/55",
      "abcdef1234567890",
    ]);

    const detailReads = calls("github_get_workflow_run_details").length;
    const logReads = calls("github_get_workflow_job_logs").length;
    await chooseRunAction("Refresh");
    expect(calls("github_get_workflow_run_details").length).toBeGreaterThan(detailReads);
    expect(calls("github_get_workflow_job_logs").length).toBeGreaterThan(logReads);

    await click(view().getByRole("button", { name: "Open on GitHub" }));
    expect(mocks.openExternalUrl).toHaveBeenCalledWith(
      "https://github.com/athasdev/athas/actions/runs/55",
    );
  });

  it("copies and exports the visible log lines", async () => {
    mocks.saveTextFile.mockImplementation(async (_options: unknown, contents: () => string) => {
      contents();
      return "/tmp/run.log";
    });
    await render();

    await click(view().getByRole("button", { name: "Copy logs" }));
    expect(mocks.clipboard[0]).toContain("test parser failed");
    expect(mocks.toast.success).toHaveBeenCalledWith("Logs copied");

    await click(view().getByRole("button", { name: "More log actions" }));
    await click(menuItem("Export log"));
    expect(mocks.saveTextFile).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "run-55-Run_tests.log" }),
      expect.any(Function),
    );
    expect(mocks.toast.success).toHaveBeenCalledWith("Log exported");

    mocks.saveTextFile.mockRejectedValueOnce(new Error("disk full"));
    await click(view().getByRole("button", { name: "More log actions" }));
    await click(menuItem("Export log"));
    expect(mocks.toast.error).toHaveBeenCalledWith("disk full");
  });

  it("filters log lines", async () => {
    await render();

    await act(async () => {
      fireEvent.change(view().getByRole("textbox", { name: "Filter log lines" }), {
        target: { value: "nothing matches" },
      });
    });
    await settle();

    expect((view().getByRole("button", { name: "Copy logs" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("opens the head commit locally, falling back to GitHub", async () => {
    await render();

    await click(view().getByText("abcdef1"));
    expect(mocks.openCommitDiff).toHaveBeenCalledWith(
      expect.objectContaining({ repoPath: "/repo", commitHash: "abcdef1234567890" }),
    );
    expect(mocks.openExternalUrl).not.toHaveBeenCalled();

    mocks.openCommitDiff.mockResolvedValueOnce(null);
    await click(view().getByText("abcdef1"));
    expect(mocks.openExternalUrl).toHaveBeenCalledWith(
      "https://github.com/athasdev/athas/commit/abcdef1234567890",
    );
  });

  it("shows a failed run load and retries it", async () => {
    let attempts = 0;
    handlers.github_get_workflow_run_details = () => {
      attempts += 1;
      if (attempts === 1) throw new Error("run not found");
      return FAILED_RUN;
    };
    await render();

    expect(view().getByText("run not found")).toBeTruthy();
    await click(view().getByRole("button", { name: "Retry" }));
    expect(view().getByText("Nightly tests")).toBeTruthy();
  });

  it("needs a repository", async () => {
    await render({ repoPath: undefined });

    expect(view().getByText("No repository selected.")).toBeTruthy();
  });

  it("resolves a run from a notification", async () => {
    handlers.github_resolve_notification_workflow_run = () => workflowRun(55);
    await render({
      runId: undefined,
      notification: {
        id: "n1",
        repositoryFullName: "athasdev/athas",
        checkSuiteId: 9,
        title: "CI failed",
        updatedAt: "2026-10-10T00:00:00Z",
      },
    });

    expect(calls("github_resolve_notification_workflow_run")).toEqual([
      {
        repositoryFullName: "athasdev/athas",
        checkSuiteId: 9,
        notificationTitle: "CI failed",
        notificationUpdatedAt: "2026-10-10T00:00:00Z",
      },
    ]);
    expect(calls("github_get_workflow_run_details")).toEqual([{ repoPath: "/repo", runId: 55 }]);
    expect(view().getByText("Nightly tests")).toBeTruthy();
  });

  it("reports a notification that matches no run", async () => {
    handlers.github_resolve_notification_workflow_run = () => null;
    await render({
      runId: undefined,
      notification: {
        id: "n1",
        repositoryFullName: "athasdev/athas",
        checkSuiteId: null,
        title: "CI failed",
        updatedAt: "2026-10-10T00:00:00Z",
      },
    });

    expect(
      view().getByText("Could not match this notification to a GitHub Actions run."),
    ).toBeTruthy();

    handlers.github_resolve_notification_workflow_run = () => {
      throw new Error("network down");
    };
    await click(view().getByRole("button", { name: "Retry" }));
    expect(view().getByText("network down")).toBeTruthy();
  });

  it("refreshes details when the run list reports a newer attempt", async () => {
    client.setQueryData(githubKeys.workflowRuns("/repo"), [workflowRun(55, { runAttempt: 3 })]);
    await render();

    expect(calls("github_get_workflow_run_details").length).toBe(2);
  });
});
