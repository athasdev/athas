import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { clearRepositoryDiscoveryCache } from "../api/git-repo-api";
import { getGitStatus } from "../api/git-status-api";

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

    await Promise.resolve();
    await Promise.resolve();

    expect(mockInvoke).toHaveBeenCalledTimes(3);
    expect(mockInvoke).toHaveBeenCalledWith("git_status", { repoPath: "/workspace" });

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
});
