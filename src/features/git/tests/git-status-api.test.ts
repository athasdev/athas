import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { clearRepositoryDiscoveryCache } from "../api/git-repo-api";
import { getGitStatus } from "../api/git-status-api";
import { invalidateGitCaches } from "../runtime/git-cache-registry";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);

describe("git status api", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    clearRepositoryDiscoveryCache();
  });

  it("reuses in-flight status requests for the same resolved repository", async () => {
    let resolveStatus: ((status: unknown) => void) | undefined;
    const statusPromise = new Promise((resolve) => {
      resolveStatus = resolve;
    });

    mockInvoke.mockImplementation((command) => {
      if (command === "git_discover_repo") {
        return Promise.resolve("/workspace");
      }
      if (command === "git_status") {
        return statusPromise;
      }
      return Promise.resolve(null);
    });

    const first = getGitStatus("/workspace/project");
    const second = getGitStatus("/workspace/project");

    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("git_status", { repoPath: "/workspace" });
    });
    expect(mockInvoke.mock.calls.filter(([command]) => command === "git_status")).toHaveLength(1);

    resolveStatus?.({
      branch: "main",
      files: [],
      staged_files: [],
      unstaged_files: [],
      untracked_files: [],
    });

    await expect(Promise.all([first, second])).resolves.toEqual([
      {
        branch: "main",
        files: [],
        staged_files: [],
        unstaged_files: [],
        untracked_files: [],
      },
      {
        branch: "main",
        files: [],
        staged_files: [],
        unstaged_files: [],
        untracked_files: [],
      },
    ]);
  });

  it("retries when a repository changes during an in-flight status request", async () => {
    let resolveFirst: ((status: unknown) => void) | undefined;
    let resolveSecond: ((status: unknown) => void) | undefined;
    const firstStatus = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const secondStatus = new Promise((resolve) => {
      resolveSecond = resolve;
    });
    let statusRequestCount = 0;

    mockInvoke.mockImplementation((command) => {
      if (command === "git_discover_repo") return Promise.resolve("/workspace");
      if (command === "git_status") {
        statusRequestCount += 1;
        return statusRequestCount === 1 ? firstStatus : secondStatus;
      }
      return Promise.resolve(null);
    });

    const request = getGitStatus("/workspace");
    await vi.waitFor(() => expect(statusRequestCount).toBe(1));
    invalidateGitCaches({ repoPath: "/workspace" });
    resolveFirst?.({ branch: "old", files: [] });
    await vi.waitFor(() => expect(statusRequestCount).toBe(2));
    resolveSecond?.({ branch: "new", files: [] });

    await expect(request).resolves.toEqual({ branch: "new", files: [] });
  });
});
