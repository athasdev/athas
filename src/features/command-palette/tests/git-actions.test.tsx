import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createGitActions } from "../constants/git-actions";

function createActions() {
  return {
    setIsSidebarVisible: vi.fn(),
    setActiveView: vi.fn(),
    showToast: vi.fn(),
    onClose: vi.fn(),
    gitStore: {
      actions: {
        setIsRefreshing: vi.fn(),
      },
    },
    gitOperations: {
      stageAllFiles: vi.fn(),
      unstageAllFiles: vi.fn(),
      commitChanges: vi.fn(),
      pushChanges: vi.fn(),
      pullChanges: vi.fn(),
      fetchChanges: vi.fn(),
      discardAllChanges: vi.fn(),
    },
  };
}

describe("createGitActions", () => {
  beforeEach(() => {
    vi.mocked(window.dispatchEvent).mockClear();
  });

  it("opens the stash surface without switching the sidebar to git", () => {
    const params = createActions();

    const actions = createGitActions({
      rootFolderPath: "/repo",
      activeRepoPath: null,
      ...params,
    });

    actions.find((action) => action.id === "git-view-stashes")?.action();

    expect(params.onClose).toHaveBeenCalledOnce();
    expect(params.setIsSidebarVisible).not.toHaveBeenCalled();
    expect(params.setActiveView).not.toHaveBeenCalled();
    expect(window.dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { type: "view-stashes" },
      }),
    );
  });
});
