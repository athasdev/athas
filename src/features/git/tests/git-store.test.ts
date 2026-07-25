import { describe, expect, it, vi } from "vite-plus/test";
import { createGitStore } from "../stores/git.store";
import type { GitCommit } from "../types/git.types";

vi.mock("../api/git-commits-api", () => ({
  getGitLog: vi.fn(),
}));

const commit = (hash: string): GitCommit => ({
  hash,
  message: hash,
  author: "Athas",
  email: "dev@athas.dev",
  date: "2026-07-25",
});

describe("git store repository ownership", () => {
  it("clears repository-specific data before loading another repository", () => {
    const store = createGitStore();
    store.getState().actions.prepareRepositoryLoad("/first");
    store.getState().actions.loadFreshGitData({
      gitStatus: { branch: "main", ahead: 0, behind: 0, files: [] },
      commits: [commit("first")],
      branches: ["main"],
      stashes: [],
      repoPath: "/first",
    });

    store.getState().actions.prepareRepositoryLoad("/second");

    expect(store.getState().gitStatus).toBeNull();
    expect(store.getState().commits).toEqual([]);
    expect(store.getState().currentRepoPath).toBe("/second");
  });

  it("ignores a stale refresh after switching repositories", () => {
    const store = createGitStore();
    const actions = store.getState().actions;
    actions.prepareRepositoryLoad("/first");
    actions.loadFreshGitData({
      gitStatus: { branch: "main", ahead: 0, behind: 0, files: [] },
      commits: [commit("old")],
      branches: ["main"],
      stashes: [],
      repoPath: "/first",
    });

    actions.prepareRepositoryLoad("/second");
    actions.refreshGitData({
      gitStatus: { branch: "feature", ahead: 0, behind: 0, files: [] },
      branches: ["feature"],
      commits: [commit("new")],
      repoPath: "/first",
    });

    expect(store.getState().currentRepoPath).toBe("/second");
    expect(store.getState().gitStatus).toBeNull();
    expect(store.getState().commits).toEqual([]);
  });

  it("loads the first commit when an empty repository gains history", async () => {
    const store = createGitStore();
    const actions = store.getState().actions;
    actions.prepareRepositoryLoad("/repo");
    actions.loadFreshGitData({
      gitStatus: { branch: "main", ahead: 0, behind: 0, files: [] },
      commits: [],
      branches: ["main"],
      stashes: [],
      repoPath: "/repo",
    });

    actions.refreshGitData({
      gitStatus: { branch: "main", ahead: 0, behind: 0, files: [] },
      branches: ["main"],
      commits: [commit("first")],
      repoPath: "/repo",
    });

    expect(store.getState().commits).toEqual([commit("first")]);
  });

  it("replaces stale history after a rewrite", async () => {
    const store = createGitStore();
    const actions = store.getState().actions;
    actions.prepareRepositoryLoad("/repo");
    actions.loadFreshGitData({
      gitStatus: { branch: "main", ahead: 0, behind: 0, files: [] },
      commits: [commit("old-head"), commit("old-parent")],
      branches: ["main"],
      stashes: [],
      repoPath: "/repo",
    });

    actions.refreshGitData({
      gitStatus: { branch: "main", ahead: 0, behind: 0, files: [] },
      branches: ["main"],
      commits: [commit("rewritten")],
      repoPath: "/repo",
    });

    expect(store.getState().commits).toEqual([commit("rewritten")]);
    expect(store.getState().hasMoreCommits).toBe(false);
  });
});
