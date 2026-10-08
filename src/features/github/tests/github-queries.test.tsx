// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider, useQuery, type QueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createTestQueryClient } from "@/utils/tests/query-test-client";
import type { IssueDetails, IssueListItem, PullRequestDetails } from "../types/github.types";
import { useCachedPullRequest } from "../hooks/use-cached-pull-request";
import { useWorkflowRunActions } from "../hooks/use-workflow-run-actions";
import {
  issueListQuery,
  pullRequestDetailsQuery,
  pullRequestListQuery,
  storeIssueDetails,
  workflowRunsQuery,
} from "../services/github-queries";
import { useGitHubStore } from "../stores/github.store";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("../services/github-token-service", () => ({
  syncGitHubTokenFromAccount: vi.fn(async () => ({ status: "notConnected" })),
}));

const mockInvoke = vi.mocked(invoke);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function pullRequestDetails(number: number, title: string, state = "OPEN") {
  return {
    number,
    title,
    body: "",
    state,
    author: { login: "athasdev" },
    createdAt: "2026-08-04T00:00:00.000Z",
    updatedAt: "2026-08-04T00:00:00.000Z",
    isDraft: false,
    reviewDecision: null,
    url: `https://github.com/athasdev/athas/pull/${number}`,
    headRef: `feature-${number}`,
    baseRef: "main",
    additions: 1,
    deletions: 0,
    changedFiles: 1,
    commits: [],
    labels: [],
    assignees: [],
    reviewRequests: [],
    statusChecks: [],
    linkedIssues: [],
    reviews: [],
  } as unknown as PullRequestDetails;
}

function issue(number: number, title: string): IssueListItem {
  return {
    number,
    title,
    state: "OPEN",
    author: { login: "athasdev" },
    updatedAt: "2026-08-04T00:00:00.000Z",
    url: `https://github.com/athasdev/athas/issues/${number}`,
    labels: [],
  } as unknown as IssueListItem;
}

function run(databaseId: number, status: string) {
  return { databaseId, status, conclusion: null, name: `Run ${databaseId}`, url: "" };
}

let client: QueryClient;
let container: HTMLDivElement;
let root: Root;

async function render(ui: ReactNode) {
  await act(async () => {
    root.render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  });
}

/** Query notifies observers on a macrotask, so wait a few of them. */
async function flush() {
  await act(async () => {
    for (let index = 0; index < 5; index++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mockInvoke.mockReset();
  client = createTestQueryClient();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  useGitHubStore.getState().actions.reset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  client.clear();
});

function PullRequestViewerProbe({ repoPath, prNumber }: { repoPath: string; prNumber: number }) {
  const details = useQuery(pullRequestDetailsQuery(repoPath, prNumber)).data;
  return <div data-testid={`viewer-${repoPath}-${prNumber}`}>{details?.title ?? "loading"}</div>;
}

function PullRequestChromeProbe({ repoPath, prNumber }: { repoPath: string; prNumber: number }) {
  const { details } = useCachedPullRequest(repoPath, prNumber);
  return <div data-testid={`chrome-${repoPath}-${prNumber}`}>{details?.title ?? "none"}</div>;
}

const text = (testId: string) =>
  container.querySelector(`[data-testid="${testId}"]`)?.textContent ?? null;

describe("GitHub pull request queries", () => {
  it("keeps two pull request viewers on their own pull requests", async () => {
    mockInvoke.mockImplementation(async (command, args) => {
      const { prNumber } = args as { prNumber: number };
      if (command === "github_get_pr_details") {
        return pullRequestDetails(prNumber, `PR ${prNumber}`);
      }
      throw new Error(`unexpected ${command}`);
    });

    await render(
      <>
        <PullRequestViewerProbe repoPath="/repo" prNumber={1} />
        <PullRequestViewerProbe repoPath="/repo" prNumber={2} />
        <PullRequestChromeProbe repoPath="/repo" prNumber={1} />
        <PullRequestChromeProbe repoPath="/repo" prNumber={2} />
      </>,
    );
    await flush();

    expect(text("viewer-/repo-1")).toBe("PR 1");
    expect(text("viewer-/repo-2")).toBe("PR 2");
    expect(text("chrome-/repo-1")).toBe("PR 1");
    expect(text("chrome-/repo-2")).toBe("PR 2");
  });

  it("does not show another repository's pull request with the same number", async () => {
    mockInvoke.mockImplementation(async (_command, args) => {
      const { repoPath, prNumber } = args as { repoPath: string; prNumber: number };
      return pullRequestDetails(prNumber, `${repoPath} #${prNumber}`);
    });

    await render(
      <>
        <PullRequestViewerProbe repoPath="/repo-a" prNumber={7} />
        <PullRequestChromeProbe repoPath="/repo-b" prNumber={7} />
      </>,
    );
    await flush();

    expect(text("viewer-/repo-a-7")).toBe("/repo-a #7");
    expect(text("chrome-/repo-b-7")).toBe("none");
  });

  it("turns authentication failures into the sign-in state", async () => {
    useGitHubStore.setState({ isAuthenticated: true, currentUser: "athasdev" });
    mockInvoke.mockRejectedValue(new Error("401 unauthorized token"));

    await expect(
      client.query(
        pullRequestListQuery("/repo", "all", useGitHubStore.getState().actions.markAuthFailed),
      ),
    ).rejects.toThrow("401");

    expect(useGitHubStore.getState()).toMatchObject({
      isAuthenticated: false,
      currentUser: null,
      authError: "401 unauthorized token",
    });
  });
});

describe("GitHub issue queries", () => {
  it("refreshes a visible issue list after an issue is edited", async () => {
    let listedTitle = "Old title";
    mockInvoke.mockImplementation(async (command) => {
      if (command === "github_list_issues") return [issue(5, listedTitle)];
      throw new Error(`unexpected ${command}`);
    });

    function IssueListProbe() {
      const issues = useQuery(issueListQuery("/repo", "open")).data;
      return <div data-testid="issues">{issues?.map((item) => item.title).join(",")}</div>;
    }

    await render(<IssueListProbe />);
    await flush();
    expect(text("issues")).toBe("Old title");

    listedTitle = "New title";
    await act(async () => {
      await storeIssueDetails(client, "/repo", {
        number: 5,
        title: "New title",
      } as IssueDetails);
    });
    await flush();

    expect(text("issues")).toBe("New title");
    expect(
      mockInvoke.mock.calls.filter(([command]) => command === "github_list_issues"),
    ).toHaveLength(2);
  });
});

describe("GitHub Actions queries", () => {
  it("refreshes runs after a re-run without reusing a request that started before it", async () => {
    const preMutationList = deferred<unknown[]>();
    let listCalls = 0;
    mockInvoke.mockImplementation(async (command) => {
      if (command === "github_list_workflow_runs") {
        listCalls += 1;
        return listCalls === 1
          ? [run(1, "completed")]
          : listCalls === 2
            ? preMutationList.promise
            : [run(1, "queued")];
      }
      if (command === "github_rerun_workflow_run") return null;
      if (command === "github_get_workflow_run_details") return run(1, "queued");
      throw new Error(`unexpected ${command}`);
    });

    let actions!: ReturnType<typeof useWorkflowRunActions>;
    function RunsProbe() {
      actions = useWorkflowRunActions();
      const runs = useQuery(workflowRunsQuery("/repo")).data;
      return <div data-testid="runs">{runs?.map((item) => item.status).join(",")}</div>;
    }

    await render(<RunsProbe />);
    await flush();
    expect(text("runs")).toBe("completed");

    // A background refresh starts before the re-run and answers with the old state afterwards.
    void client.refetchQueries({ queryKey: ["github", "/repo", "runs"] });
    await flush();
    await act(async () => {
      await actions.rerunRun("/repo", 1, false);
    });
    preMutationList.resolve([run(1, "completed")]);
    await flush();

    expect(listCalls).toBe(3);
    expect(text("runs")).toBe("queued");
  });
});
