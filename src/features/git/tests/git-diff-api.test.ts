import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { getFileDiff, getStatusDiffStats } from "../api/git-diff-api";
import { clearRepositoryDiscoveryCache } from "../api/git-repo-api";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);

describe("git diff api", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    clearRepositoryDiscoveryCache();
  });

  it("reuses in-flight file diff requests for the same resolved file", async () => {
    let resolveDiff: ((diff: unknown) => void) | undefined;
    const diffPromise = new Promise((resolve) => {
      resolveDiff = resolve;
    });

    mockInvoke.mockImplementation((command) => {
      if (command === "git_discover_repo") {
        return Promise.resolve("/repo");
      }
      if (command === "git_diff_file") {
        return diffPromise;
      }
      return Promise.resolve(null);
    });

    const first = getFileDiff("/repo", "src/app.ts", false);
    const second = getFileDiff("/repo", "src/app.ts", false);

    await Promise.resolve();
    await Promise.resolve();

    expect(mockInvoke).toHaveBeenCalledTimes(3);
    expect(mockInvoke).toHaveBeenCalledWith("git_diff_file", {
      repoPath: "/repo",
      filePath: "src/app.ts",
      staged: false,
    });

    const diff = {
      file_path: "src/app.ts",
      old_path: null,
      new_path: "src/app.ts",
      is_binary: false,
      is_deleted: false,
      is_new: false,
      is_renamed: false,
      lines: [],
    };
    resolveDiff?.(diff);

    await expect(Promise.all([first, second])).resolves.toEqual([diff, diff]);
  });

  it("reuses in-flight status diff stat requests for the same resolved repository", async () => {
    let resolveStats: ((stats: unknown) => void) | undefined;
    const statsPromise = new Promise((resolve) => {
      resolveStats = resolve;
    });

    mockInvoke.mockImplementation((command) => {
      if (command === "git_discover_repo") {
        return Promise.resolve("/repo");
      }
      if (command === "git_status_diff_stats") {
        return statsPromise;
      }
      return Promise.resolve(null);
    });

    const first = getStatusDiffStats("/repo/project");
    const second = getStatusDiffStats("/repo/project");

    await Promise.resolve();
    await Promise.resolve();

    expect(mockInvoke).toHaveBeenCalledTimes(3);
    expect(mockInvoke).toHaveBeenCalledWith("git_status_diff_stats", {
      repoPath: "/repo",
    });

    const stats = [
      {
        file_path: "src/app.ts",
        staged: false,
        additions: 12,
        deletions: 3,
      },
    ];
    resolveStats?.(stats);

    await expect(Promise.all([first, second])).resolves.toEqual([stats, stats]);
  });
});
