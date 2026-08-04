import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { PullRequest } from "../types/github.types";
import { useGitHubStore } from "../stores/github.store";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("../services/github-token-service", () => ({
  syncGitHubTokenFromAccount: vi.fn(async () => ({ status: "notConnected" })),
}));

const mockInvoke = vi.mocked(invoke);

function pullRequest(number: number, title: string): PullRequest {
  return {
    number,
    title,
    state: "OPEN",
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
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("GitHub store", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    useGitHubStore.getState().actions.reset();
  });

  it("keeps the newest pull request request when older work finishes last", async () => {
    const first = deferred<PullRequest[]>();
    const second = deferred<PullRequest[]>();
    mockInvoke
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const firstRequest = useGitHubStore.getState().actions.fetchPRs("/repo-a", { force: true });
    const secondRequest = useGitHubStore.getState().actions.fetchPRs("/repo-b", { force: true });
    second.resolve([pullRequest(2, "Newest")]);
    await secondRequest;
    first.resolve([pullRequest(1, "Stale")]);
    await firstRequest;

    expect(useGitHubStore.getState()).toMatchObject({
      activeRepoPath: "/repo-b",
      prs: [expect.objectContaining({ number: 2, title: "Newest" })],
      isLoading: false,
    });
  });

  it("reuses a fresh pull request list cache", async () => {
    mockInvoke.mockResolvedValueOnce([pullRequest(3, "Cached")]);

    await useGitHubStore.getState().actions.fetchPRs("/repo");
    await useGitHubStore.getState().actions.fetchPRs("/repo");

    expect(mockInvoke).toHaveBeenCalledOnce();
    expect(useGitHubStore.getState().prs[0]?.number).toBe(3);
  });

  it("turns authentication failures into auth state instead of list errors", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("401 unauthorized token"));

    await useGitHubStore.getState().actions.fetchPRs("/repo", { force: true });

    expect(useGitHubStore.getState()).toMatchObject({
      isAuthenticated: false,
      isLoading: false,
      error: null,
      authError: "401 unauthorized token",
    });
  });
});
