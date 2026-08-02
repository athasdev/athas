import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { getFileDiff, getStatusDiffStats, invalidateGitDiffData } from "../api/git-diff-api";
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

    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("git_diff_file", {
        repoPath: "/repo",
        filePath: "src/app.ts",
        staged: false,
      });
    });
    expect(
      mockInvoke.mock.calls.filter(([command]) => command === "git_discover_repo"),
    ).toHaveLength(1);
    expect(mockInvoke.mock.calls.filter(([command]) => command === "git_diff_file")).toHaveLength(
      1,
    );

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

    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("git_status_diff_stats", {
        repoPath: "/repo",
      });
    });
    expect(
      mockInvoke.mock.calls.filter(([command]) => command === "git_discover_repo"),
    ).toHaveLength(1);
    expect(
      mockInvoke.mock.calls.filter(([command]) => command === "git_status_diff_stats"),
    ).toHaveLength(1);

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

  it("retries status diff stats invalidated while the native read is in flight", async () => {
    let resolveFirst: ((stats: unknown) => void) | undefined;
    const firstStats = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const freshStats = [
      {
        file_path: "src/fresh.ts",
        staged: false,
        additions: 1,
        deletions: 0,
      },
    ];
    let statusReadCount = 0;

    mockInvoke.mockImplementation((command) => {
      if (command === "git_discover_repo") {
        return Promise.resolve("/repo");
      }
      if (command === "git_status_diff_stats") {
        statusReadCount += 1;
        return statusReadCount === 1 ? firstStats : Promise.resolve(freshStats);
      }
      return Promise.resolve(null);
    });

    const request = getStatusDiffStats("/repo");
    await vi.waitFor(() => expect(statusReadCount).toBe(1));
    invalidateGitDiffData("/repo");
    resolveFirst?.([]);

    await expect(request).resolves.toEqual(freshStats);
    expect(statusReadCount).toBe(2);
  });
});
