import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { getGitLog } from "../api/git-commits-api";
import { getGitStatus } from "../api/git-status-api";
import { createGitStore } from "../stores/git.store";
import type { GitCommit, GitStatus } from "../types/git.types";

vi.mock("../api/git-commits-api", () => ({ getGitLog: vi.fn() }));
vi.mock("../api/git-status-api", () => ({ getGitStatus: vi.fn() }));

const mockGetGitLog = vi.mocked(getGitLog);
const mockGetGitStatus = vi.mocked(getGitStatus);

const commit = (hash: string): GitCommit => ({
  hash,
  message: hash,
  author: "Athas",
  email: "dev@athas.dev",
  date: "2026-07-25",
});
const page = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => commit(`${prefix}${index}`));
const status = (files: GitStatus["files"] = [], branch = "main"): GitStatus => ({
  branch,
  ahead: 0,
  behind: 0,
  files,
});

function storeWithHistory(commits: GitCommit[]) {
  const store = createGitStore();
  store.getState().actions.prepareRepositoryLoad("/repo");
  store.getState().actions.loadFreshGitData({
    gitStatus: status(),
    commits,
    branches: [],
    stashes: [],
    repoPath: "/repo",
  });
  return store;
}

describe("git store history paging", () => {
  beforeEach(() => {
    mockGetGitLog.mockReset();
    mockGetGitStatus.mockReset();
  });

  it("appends the next page after the commits already loaded", async () => {
    const store = storeWithHistory(page("a", 50));
    mockGetGitLog.mockResolvedValue(page("b", 50));

    await store.getState().actions.loadMoreCommits("/repo");

    expect(mockGetGitLog).toHaveBeenCalledWith("/repo", 50, 50);
    expect(store.getState().commits).toHaveLength(100);
    expect(store.getState().hasMoreCommits).toBe(true);
    expect(store.getState().isLoadingMoreCommits).toBe(false);
  });

  it("drops duplicates and stops paging on a short page", async () => {
    const store = storeWithHistory(page("a", 50));
    mockGetGitLog.mockResolvedValue([commit("a49"), commit("b0")]);

    await store.getState().actions.loadMoreCommits("/repo");

    expect(store.getState().commits.slice(-1)[0]?.hash).toBe("b0");
    expect(store.getState().commits).toHaveLength(51);
    expect(store.getState().hasMoreCommits).toBe(false);
  });

  it("stops paging when a page brings nothing new", async () => {
    const store = storeWithHistory(page("a", 50));
    mockGetGitLog.mockResolvedValue([commit("a0")]);

    await store.getState().actions.loadMoreCommits("/repo");

    expect(store.getState().commits).toHaveLength(50);
    expect(store.getState().hasMoreCommits).toBe(false);
  });

  it("does not page when there is no more history, another page is loading or the repository differs", async () => {
    const short = storeWithHistory(page("a", 3));
    await short.getState().actions.loadMoreCommits("/repo");

    const full = storeWithHistory(page("a", 50));
    await full.getState().actions.loadMoreCommits("/other");
    full.setState({ isLoadingMoreCommits: true });
    await full.getState().actions.loadMoreCommits("/repo");

    expect(mockGetGitLog).not.toHaveBeenCalled();
  });

  it("discards a page that arrives after switching repositories", async () => {
    const store = storeWithHistory(page("a", 50));
    let resolvePage: (commits: GitCommit[]) => void = () => {};
    mockGetGitLog.mockReturnValue(
      new Promise((resolve) => {
        resolvePage = resolve;
      }),
    );

    const loading = store.getState().actions.loadMoreCommits("/repo");
    expect(store.getState().isLoadingMoreCommits).toBe(true);
    store.getState().actions.prepareRepositoryLoad("/other");
    resolvePage(page("b", 50));
    await loading;

    expect(store.getState().commits).toEqual([]);
    expect(store.getState().isLoadingMoreCommits).toBe(false);
  });

  it("clears the loading flag when paging fails", async () => {
    const store = storeWithHistory(page("a", 50));
    mockGetGitLog.mockRejectedValue(new Error("boom"));

    await expect(store.getState().actions.loadMoreCommits("/repo")).rejects.toThrow("boom");

    expect(store.getState().isLoadingMoreCommits).toBe(false);
  });
});

describe("git store status updates", () => {
  beforeEach(() => {
    mockGetGitStatus.mockReset();
  });

  it("keeps the same status object when a refresh reports the same files", () => {
    const store = storeWithHistory([]);
    const files = [{ path: "a.ts", status: "modified" as const, staged: false }];
    store.getState().actions.setGitStatus(status(files));
    const first = store.getState().gitStatus;

    store.getState().actions.setGitStatus(status(files.map((file) => ({ ...file }))));
    expect(store.getState().gitStatus).toBe(first);

    store.getState().actions.setGitStatus(status([{ ...files[0], staged: true }]));
    expect(store.getState().gitStatus).not.toBe(first);

    store.getState().actions.setGitStatus(status([], "dev"));
    expect(store.getState().gitStatus?.branch).toBe("dev");
  });

  it("refreshes the workspace status only for the current workspace repository", async () => {
    const store = createGitStore();
    store.getState().actions.setWorkspaceGitStatus(status(), "/repo");
    const before = store.getState().workspaceGitStatusUpdatedAt;
    mockGetGitStatus.mockResolvedValue(status([{ path: "x", status: "added", staged: true }]));

    await store.getState().actions.refreshWorkspaceGitStatus("/elsewhere");
    expect(store.getState().workspaceGitStatus?.files).toEqual([]);

    await store.getState().actions.refreshWorkspaceGitStatus("/repo");
    expect(store.getState().workspaceGitStatus?.files).toHaveLength(1);
    expect(store.getState().workspaceGitStatusUpdatedAt).toBeGreaterThanOrEqual(before);
  });

  it("resets everything", () => {
    const store = storeWithHistory(page("a", 2));
    store.getState().actions.setBranches(["main"]);
    store.getState().actions.setStashes([{ index: 0, message: "wip" } as never]);
    store.getState().actions.setCommits([commit("x")]);
    store.getState().actions.setIsRefreshing(true);

    store.getState().actions.reset();

    expect(store.getState()).toMatchObject({
      gitStatus: null,
      commits: [],
      branches: [],
      stashes: [],
      isRefreshing: false,
      currentRepoPath: null,
      workspaceGitStatus: null,
    });
  });
});
