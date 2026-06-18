import { describe, expect, it, vi } from "vite-plus/test";
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
  it("registers manager-backed git command aliases", () => {
    const actions = createGitActions({
      rootFolderPath: "/repo",
      activeRepoPath: null,
      ...createActions(),
    });

    expect(actions.map((action) => action.label)).toEqual(
      expect.arrayContaining([
        "Git: Checkout Branch",
        "Git: Create Branch",
        "Git: Delete Branch",
        "Git: Show Branch Diff",
        "Git: Initialize Repository",
        "Git: Add Remote",
        "Git: Remove Remote",
        "Git: Create Tag",
        "Git: Delete Tag",
        "Git: Compare Tags",
        "Git: Apply Stash",
        "Git: Pop Stash",
        "Git: Drop Stash",
      ]),
    );
  });

  it("opens the branch diff picker from the git sidebar", () => {
    const params = createActions();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", {
      CustomEvent,
      dispatchEvent,
      setTimeout: (callback: () => void) => {
        callback();
        return 0;
      },
    });

    const actions = createGitActions({
      rootFolderPath: "/repo",
      activeRepoPath: null,
      ...params,
    });

    actions.find((action) => action.id === "git-show-branch-diff")?.action();

    expect(params.setIsSidebarVisible).toHaveBeenCalledWith(true);
    expect(params.setActiveView).toHaveBeenCalledWith("git");
    expect(params.onClose).toHaveBeenCalledOnce();
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { type: "show-branch-diff" },
      }),
    );

    vi.unstubAllGlobals();
  });

  it("opens the branch manager through the git sidebar", () => {
    const params = createActions();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", {
      CustomEvent,
      dispatchEvent,
      setTimeout: (callback: () => void) => {
        callback();
        return 0;
      },
    });

    const actions = createGitActions({
      rootFolderPath: "/repo",
      activeRepoPath: null,
      ...params,
    });

    actions.find((action) => action.id === "git-branch-manager")?.action();

    expect(params.setIsSidebarVisible).toHaveBeenCalledWith(true);
    expect(params.setActiveView).toHaveBeenCalledWith("git");
    expect(params.onClose).toHaveBeenCalledOnce();
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { type: "manage-branches" },
      }),
    );

    vi.unstubAllGlobals();
  });

  it("opens the stash surface without switching the sidebar to git", () => {
    const params = createActions();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", {
      CustomEvent,
      dispatchEvent,
      setTimeout: (callback: () => void) => {
        callback();
        return 0;
      },
    });

    const actions = createGitActions({
      rootFolderPath: "/repo",
      activeRepoPath: null,
      ...params,
    });

    actions.find((action) => action.id === "git-view-stashes")?.action();

    expect(params.onClose).toHaveBeenCalledOnce();
    expect(params.setIsSidebarVisible).not.toHaveBeenCalled();
    expect(params.setActiveView).not.toHaveBeenCalled();
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { type: "view-stashes" },
      }),
    );

    vi.unstubAllGlobals();
  });
});
