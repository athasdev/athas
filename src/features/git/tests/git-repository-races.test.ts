import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { discoverWorkspaceRepositories } from "../api/git-repo-api";
import { createGitRepositoryStore } from "../stores/git-repository.store";

vi.mock("../api/git-repo-api", () => ({
  discoverWorkspaceRepositories: vi.fn(),
  normalizeRepositoryPath: (path: string) => path.replace(/\/+$/, ""),
}));

const mockDiscoverWorkspaceRepositories = vi.mocked(discoverWorkspaceRepositories);

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

describe("git repository discovery races", () => {
  beforeEach(() => mockDiscoverWorkspaceRepositories.mockReset());

  it("does not let an older workspace scan replace the current workspace", async () => {
    const first = deferred<string[]>();
    const second = deferred<string[]>();
    mockDiscoverWorkspaceRepositories
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const store = createGitRepositoryStore();

    const firstRequest = store.getState().actions.syncWorkspaceRepositories("/workspace/one");
    const secondRequest = store.getState().actions.syncWorkspaceRepositories("/workspace/two");

    second.resolve(["/workspace/two"]);
    await secondRequest;
    first.resolve(["/workspace/one"]);
    await firstRequest;

    expect(store.getState().workspaceRootPath).toBe("/workspace/two");
    expect(store.getState().workspaceRepoPaths).toEqual(["/workspace/two"]);
    expect(store.getState().activeRepoPath).toBe("/workspace/two");
  });

  it("remembers a completed empty scan instead of rescanning on every sync", async () => {
    mockDiscoverWorkspaceRepositories.mockResolvedValue([]);
    const store = createGitRepositoryStore();

    await store.getState().actions.syncWorkspaceRepositories("/workspace");
    await store.getState().actions.syncWorkspaceRepositories("/workspace");

    expect(mockDiscoverWorkspaceRepositories).toHaveBeenCalledTimes(1);
    expect(store.getState().hasDiscoveredWorkspace).toBe(true);
  });
});
