import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { onAppEvent } from "@/utils/app-events";

const mocks = vi.hoisted(() => ({
  setIsSidebarVisible: vi.fn(),
  setActiveView: vi.fn(),
  showToast: vi.fn(),
  stageAllFiles: vi.fn(async () => true),
  repo: { activeRepoPath: "/repo" as string | null },
}));

vi.mock("@/features/layout/stores/ui-state.store", () => ({
  useUIState: {
    getState: () => ({
      setIsSidebarVisible: mocks.setIsSidebarVisible,
      setActiveView: mocks.setActiveView,
    }),
  },
}));
vi.mock("@/utils/toast", () => ({ showToast: mocks.showToast }));
vi.mock("@/features/git/stores/git-repository.store", () => ({
  useRepositoryStore: { getState: () => mocks.repo },
}));
vi.mock("@/features/file-system/stores/file-system.store", () => ({
  useFileSystemStore: { getState: () => ({}) },
}));
vi.mock("@/features/git/api/git-status-api", () => ({
  stageAllFiles: mocks.stageAllFiles,
  unstageAllFiles: vi.fn(),
  discardAllChanges: vi.fn(),
}));
vi.mock("@/features/git/api/git-commits-api", () => ({ commitChanges: vi.fn() }));
vi.mock("@/features/git/api/git-remotes-api", () => ({
  fetchChanges: vi.fn(),
  pullChanges: vi.fn(),
  pushChanges: vi.fn(),
}));

vi.mock("@/ui/dialog", () => ({ showConfirmDialog: vi.fn(), showPromptDialog: vi.fn() }));

// Load the lazily imported actions before `window` is stubbed for the sidebar timers.
await import("../commands/git-command-actions");
const { gitCommands } = await import("../commands/git-commands");

function command(id: string) {
  const found = gitCommands.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Missing command ${id}`);
  return found;
}

describe("git commands", () => {
  const gitSidebarAction = vi.fn();
  let unsubscribe = () => {};

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.repo.activeRepoPath = "/repo";
    unsubscribe = onAppEvent("athas:git-palette-action", gitSidebarAction);
    vi.stubGlobal("window", {
      setTimeout: (callback: () => void) => {
        callback();
        return 0;
      },
    });
  });

  afterEach(() => {
    unsubscribe();
    vi.unstubAllGlobals();
  });

  it("offers the manager-backed git command aliases", () => {
    expect(gitCommands.map((candidate) => candidate.title)).toEqual(
      expect.arrayContaining([
        "Git: Checkout Branch",
        "Git: Create Branch",
        "Git: Delete Branch",
        "Git: Manage Worktrees",
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

  it.each([
    ["git.openBranchManager", { type: "manage-branches", tab: "branches" }],
    ["git.manageWorktrees", { type: "manage-branches", tab: "worktrees" }],
    ["git.showBranchDiff", { type: "show-branch-diff" }],
    ["git.viewStashes", { type: "view-stashes" }],
  ])("opens %s through the git sidebar", async (id, detail) => {
    await command(id).execute();

    expect(mocks.setIsSidebarVisible).toHaveBeenCalledWith(true);
    expect(mocks.setActiveView).toHaveBeenCalledWith("git");
    expect(gitSidebarAction).toHaveBeenCalledWith(detail);
  });

  it("stages every change in the active repository", async () => {
    await command("git.stageAll").execute();

    expect(mocks.stageAllFiles).toHaveBeenCalledWith("/repo");
    expect(mocks.showToast).toHaveBeenCalledWith({
      message: "All files staged successfully",
      type: "success",
    });
  });

  it("reports when no repository is open", async () => {
    mocks.repo.activeRepoPath = null;

    await command("git.stageAll").execute();

    expect(mocks.stageAllFiles).not.toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledWith({ message: "No repository open", type: "error" });
  });
});
