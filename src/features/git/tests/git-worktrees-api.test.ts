import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { removeWorktree } from "../api/git-worktrees-api";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);

describe("git worktrees api", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("removes worktrees without force by default", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);

    await expect(removeWorktree("/repo", "/repo/worktree")).resolves.toBe(true);

    expect(mockInvoke).toHaveBeenCalledWith("git_remove_worktree", {
      repoPath: "/repo",
      path: "/repo/worktree",
      force: false,
    });
  });

  it("passes force only when explicitly requested", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);

    await expect(removeWorktree("/repo", "/repo/worktree", true)).resolves.toBe(true);

    expect(mockInvoke).toHaveBeenCalledWith("git_remove_worktree", {
      repoPath: "/repo",
      path: "/repo/worktree",
      force: true,
    });
  });
});
