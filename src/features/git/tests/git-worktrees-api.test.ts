import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { removeWorktree } from "../api/git-worktrees-api";
import { clearRepositoryDiscoveryCache } from "../api/git-repo-api";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);

describe("git worktrees api", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    clearRepositoryDiscoveryCache();
  });

  it("removes worktrees without force by default", async () => {
    mockInvoke.mockResolvedValueOnce("/repo").mockResolvedValueOnce(undefined);

    await expect(removeWorktree("/repo", "/repo/worktree")).resolves.toBe(true);

    expect(mockInvoke).toHaveBeenNthCalledWith(1, "git_discover_repo", { path: "/repo" });
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "git_remove_worktree", {
      repoPath: "/repo",
      path: "/repo/worktree",
      force: false,
    });
  });

  it("passes force only when explicitly requested", async () => {
    mockInvoke.mockResolvedValueOnce("/repo").mockResolvedValueOnce(undefined);

    await expect(removeWorktree("/repo/project", "/repo/worktree", true)).resolves.toBe(true);

    expect(mockInvoke).toHaveBeenNthCalledWith(1, "git_discover_repo", { path: "/repo/project" });
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "git_remove_worktree", {
      repoPath: "/repo",
      path: "/repo/worktree",
      force: true,
    });
  });
});
