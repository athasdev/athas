import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { onAppEvent } from "@/utils/app-events";

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  prompt: vi.fn(),
  confirm: vi.fn(),
  repo: { activeRepoPath: "/repo" as string | null },
  project: { rootFolderPath: undefined as string | undefined },
  git: {
    stageAllFiles: vi.fn(),
    unstageAllFiles: vi.fn(),
    discardAllChanges: vi.fn(),
    commitChanges: vi.fn(),
    pushChanges: vi.fn(),
    pullChanges: vi.fn(),
    fetchChanges: vi.fn(),
  },
}));

vi.mock("@/utils/toast", () => ({ showToast: mocks.toast }));
vi.mock("@/ui/dialog", () => ({
  showPromptDialog: mocks.prompt,
  showConfirmDialog: mocks.confirm,
}));
vi.mock("@/features/git/stores/git-repository.store", () => ({
  useRepositoryStore: { getState: () => mocks.repo },
}));
vi.mock("@/features/workspace/stores/project.store", () => ({
  useProjectStore: { getState: () => mocks.project },
}));
vi.mock("@/features/layout/stores/ui-state.store", () => ({
  useUIState: { getState: () => ({ setIsSidebarVisible: vi.fn(), setActiveView: vi.fn() }) },
}));
vi.mock("@/features/git/api/git-status-api", () => ({
  stageAllFiles: mocks.git.stageAllFiles,
  unstageAllFiles: mocks.git.unstageAllFiles,
  discardAllChanges: mocks.git.discardAllChanges,
}));
vi.mock("@/features/git/api/git-commits-api", () => ({ commitChanges: mocks.git.commitChanges }));
vi.mock("@/features/git/api/git-remotes-api", () => ({
  pushChanges: mocks.git.pushChanges,
  pullChanges: mocks.git.pullChanges,
  fetchChanges: mocks.git.fetchChanges,
}));

import {
  commitStagedChanges,
  discardAllWorkingChanges,
  fetchFromRemote,
  pullFromRemote,
  pushToRemote,
  refreshGitStatus,
  unstageAllChanges,
} from "../commands/git-command-actions";

const lastToast = () => mocks.toast.mock.lastCall?.[0];

beforeEach(() => {
  mocks.repo.activeRepoPath = "/repo";
  mocks.project.rootFolderPath = undefined;
  for (const fn of Object.values(mocks.git)) fn.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("git palette actions", () => {
  it("asks the sidebar to refresh and says so", () => {
    const handler = vi.fn();
    const stop = onAppEvent("git:palette-action", handler);

    refreshGitStatus();
    stop();

    expect(handler).toHaveBeenCalledWith({ type: "refresh" });
    expect(lastToast()).toEqual({ message: "Refreshing Git status...", type: "info" });
  });

  it("unstages everything in the project repository when no repository is active", async () => {
    mocks.repo.activeRepoPath = null;
    mocks.project.rootFolderPath = "/project";
    mocks.git.unstageAllFiles.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await unstageAllChanges();
    expect(mocks.git.unstageAllFiles).toHaveBeenCalledWith("/project");
    expect(lastToast()).toEqual({ message: "All files unstaged successfully", type: "success" });

    await unstageAllChanges();
    expect(lastToast()).toEqual({ message: "Failed to unstage files", type: "error" });
  });

  it("commits with the entered message", async () => {
    mocks.prompt.mockResolvedValueOnce("Fix crash on save");
    mocks.git.commitChanges.mockResolvedValueOnce(true);

    await commitStagedChanges();

    expect(mocks.git.commitChanges).toHaveBeenCalledWith("/repo", "Fix crash on save");
    expect(lastToast()).toEqual({ message: "Changes committed successfully", type: "success" });
  });

  it("does not commit without a message and reports commit failures", async () => {
    mocks.prompt.mockResolvedValueOnce("");
    await commitStagedChanges();
    expect(mocks.git.commitChanges).not.toHaveBeenCalled();

    mocks.prompt.mockResolvedValueOnce("msg");
    mocks.git.commitChanges.mockResolvedValueOnce(false);
    await commitStagedChanges();
    expect(lastToast()).toEqual({ message: "Failed to commit changes", type: "error" });

    mocks.prompt.mockResolvedValueOnce("msg");
    mocks.git.commitChanges.mockRejectedValueOnce("hook rejected");
    await commitStagedChanges();
    expect(lastToast()).toEqual({ message: "Error: hook rejected", type: "error" });
  });

  it("refuses to commit or discard without a repository", async () => {
    mocks.repo.activeRepoPath = null;

    await commitStagedChanges();
    await discardAllWorkingChanges();
    await pushToRemote();

    expect(mocks.prompt).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.git.pushChanges).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledTimes(3);
    expect(lastToast()).toEqual({ message: "No repository open", type: "error" });
  });

  it("reports remote results with the server's error when there is one", async () => {
    mocks.git.pushChanges.mockResolvedValueOnce({ success: true });
    await pushToRemote();
    expect(mocks.toast.mock.calls.map(([toast]) => toast.message)).toEqual([
      "Pushing changes...",
      "Changes pushed successfully",
    ]);

    mocks.git.pullChanges.mockResolvedValueOnce({ success: false, error: "diverged" });
    await pullFromRemote();
    expect(lastToast()).toEqual({ message: "diverged", type: "error" });

    mocks.git.fetchChanges.mockResolvedValueOnce({ success: false });
    await fetchFromRemote();
    expect(lastToast()).toEqual({ message: "Failed to fetch", type: "error" });

    mocks.git.fetchChanges.mockResolvedValueOnce({ success: true });
    await fetchFromRemote();
    expect(lastToast()).toEqual({ message: "Fetched successfully", type: "success" });

    mocks.git.pushChanges.mockRejectedValueOnce(new Error("network down"));
    await pushToRemote();
    expect(lastToast()).toEqual({ message: "Error: Error: network down", type: "error" });
  });

  it("discards changes only after confirmation", async () => {
    mocks.confirm.mockResolvedValueOnce(false);
    await discardAllWorkingChanges();
    expect(mocks.git.discardAllChanges).not.toHaveBeenCalled();

    mocks.confirm.mockResolvedValueOnce(true);
    mocks.git.discardAllChanges.mockResolvedValueOnce(true);
    await discardAllWorkingChanges();
    expect(mocks.git.discardAllChanges).toHaveBeenCalledWith("/repo");
    expect(lastToast()).toEqual({ message: "All changes discarded", type: "success" });

    mocks.confirm.mockResolvedValueOnce(true);
    mocks.git.discardAllChanges.mockRejectedValueOnce("locked");
    await discardAllWorkingChanges();
    expect(lastToast()).toEqual({ message: "Error: locked", type: "error" });
  });
});
