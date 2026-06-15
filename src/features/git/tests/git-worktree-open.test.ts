import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { openGitWorktreeWorkspace } from "../utils/git-worktree-open";

const mocks = vi.hoisted(() => ({
  createAppWindow: vi.fn(),
  handleOpenFolderByPath: vi.fn(),
  selectRepository: vi.fn(),
}));

vi.mock("@/features/file-system/stores/file-system.store", () => ({
  useFileSystemStore: {
    getState: () => ({
      handleOpenFolderByPath: mocks.handleOpenFolderByPath,
    }),
  },
}));

vi.mock("@/features/git/stores/git-repository.store", () => ({
  useRepositoryStore: {
    getState: () => ({
      actions: {
        selectRepository: mocks.selectRepository,
      },
    }),
  },
}));

vi.mock("@/features/window/utils/create-app-window", () => ({
  createAppWindow: mocks.createAppWindow,
}));

describe("openGitWorktreeWorkspace", () => {
  beforeEach(() => {
    mocks.createAppWindow.mockReset();
    mocks.handleOpenFolderByPath.mockReset();
    mocks.selectRepository.mockReset();
  });

  it("opens a worktree through the current workspace flow", async () => {
    mocks.handleOpenFolderByPath.mockResolvedValueOnce(true);

    await expect(openGitWorktreeWorkspace(" /repo/worktree ")).resolves.toBe(true);

    expect(mocks.handleOpenFolderByPath).toHaveBeenCalledWith("/repo/worktree");
    expect(mocks.selectRepository).toHaveBeenCalledWith("/repo/worktree");
    expect(mocks.createAppWindow).not.toHaveBeenCalled();
  });

  it("does not select the repository when the workspace open is cancelled", async () => {
    mocks.handleOpenFolderByPath.mockResolvedValueOnce(false);

    await expect(openGitWorktreeWorkspace("/repo/worktree")).resolves.toBe(false);

    expect(mocks.selectRepository).not.toHaveBeenCalled();
    expect(mocks.createAppWindow).not.toHaveBeenCalled();
  });

  it("opens worktrees in a new native window when requested", async () => {
    await expect(
      openGitWorktreeWorkspace("/repo/worktree", { target: "new-window" }),
    ).resolves.toBe(true);

    expect(mocks.createAppWindow).toHaveBeenCalledWith({
      path: "/repo/worktree",
      isDirectory: true,
    });
    expect(mocks.handleOpenFolderByPath).not.toHaveBeenCalled();
    expect(mocks.selectRepository).not.toHaveBeenCalled();
  });

  it("ignores empty worktree paths", async () => {
    await expect(openGitWorktreeWorkspace("   ")).resolves.toBe(false);

    expect(mocks.handleOpenFolderByPath).not.toHaveBeenCalled();
    expect(mocks.selectRepository).not.toHaveBeenCalled();
    expect(mocks.createAppWindow).not.toHaveBeenCalled();
  });
});
