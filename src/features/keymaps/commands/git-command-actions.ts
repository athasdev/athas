import { commitChanges } from "@/features/git/api/git-commits-api";
import {
  fetchChanges,
  pullChanges,
  pushChanges,
  type GitRemoteActionResult,
} from "@/features/git/api/git-remotes-api";
import {
  discardAllChanges,
  stageAllFiles,
  unstageAllFiles,
} from "@/features/git/api/git-status-api";
import { useRepositoryStore } from "@/features/git/stores/git-repository.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { showToast } from "@/features/layout/contexts/toast-context";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { showConfirmDialog, showPromptDialog } from "@/ui/dialog";

export type GitSidebarAction =
  | { type: "manage-branches"; tab: "branches" | "worktrees" }
  | { type: "show-branch-diff" }
  | { type: "select-repository" }
  | { type: "initialize-repository" }
  | { type: "show-tab"; tab: "changes" | "history" }
  | { type: "manage-remotes" }
  | { type: "manage-tags" }
  | { type: "view-stashes" }
  | { type: "refresh" };

function dispatchGitSidebarAction(detail: GitSidebarAction): void {
  window.dispatchEvent(new CustomEvent("athas:git-palette-action", { detail }));
}

/** Shows the Git sidebar, then hands the action to it once it has mounted. */
export function openGitSidebarAction(detail: GitSidebarAction): void {
  const state = useUIState.getState();
  state.setIsSidebarVisible(true);
  state.setActiveView("git");
  window.setTimeout(() => dispatchGitSidebarAction(detail), 0);
}

export function refreshGitStatus(): void {
  dispatchGitSidebarAction({ type: "refresh" });
  showToast({ message: "Refreshing Git status...", type: "info" });
}

function getRepoPath(): string | null {
  return (
    useRepositoryStore.getState().activeRepoPath ??
    useFileSystemStore.getState().rootFolderPath ??
    null
  );
}

async function runRepositoryOperation(
  operation: (repoPath: string) => Promise<void>,
): Promise<void> {
  const repoPath = getRepoPath();
  if (!repoPath) {
    showToast({ message: "No repository open", type: "error" });
    return;
  }

  try {
    await operation(repoPath);
  } catch (error) {
    showToast({ message: `Error: ${error}`, type: "error" });
  }
}

function reportResult(success: boolean, successMessage: string, failureMessage: string): void {
  showToast(
    success
      ? { message: successMessage, type: "success" }
      : { message: failureMessage, type: "error" },
  );
}

function reportRemoteResult(
  result: GitRemoteActionResult,
  successMessage: string,
  failureMessage: string,
): void {
  showToast(
    result.success
      ? { message: successMessage, type: "success" }
      : { message: result.error || failureMessage, type: "error" },
  );
}

export function stageAllChanges(): Promise<void> {
  return runRepositoryOperation(async (repoPath) => {
    reportResult(
      await stageAllFiles(repoPath),
      "All files staged successfully",
      "Failed to stage files",
    );
  });
}

export function unstageAllChanges(): Promise<void> {
  return runRepositoryOperation(async (repoPath) => {
    reportResult(
      await unstageAllFiles(repoPath),
      "All files unstaged successfully",
      "Failed to unstage files",
    );
  });
}

export async function commitStagedChanges(): Promise<void> {
  const repoPath = getRepoPath();
  if (!repoPath) {
    showToast({ message: "No repository open", type: "error" });
    return;
  }

  const message = await showPromptDialog("Enter commit message:", {
    title: "Commit Changes",
    placeholder: "Commit message",
  });
  if (!message) return;

  try {
    reportResult(
      await commitChanges(repoPath, message),
      "Changes committed successfully",
      "Failed to commit changes",
    );
  } catch (error) {
    showToast({ message: `Error: ${error}`, type: "error" });
  }
}

export function pushToRemote(): Promise<void> {
  return runRepositoryOperation(async (repoPath) => {
    showToast({ message: "Pushing changes...", type: "info" });
    reportRemoteResult(
      await pushChanges(repoPath),
      "Changes pushed successfully",
      "Failed to push changes",
    );
  });
}

export function pullFromRemote(): Promise<void> {
  return runRepositoryOperation(async (repoPath) => {
    showToast({ message: "Pulling changes...", type: "info" });
    reportRemoteResult(
      await pullChanges(repoPath),
      "Changes pulled successfully",
      "Failed to pull changes",
    );
  });
}

export function fetchFromRemote(): Promise<void> {
  return runRepositoryOperation(async (repoPath) => {
    reportRemoteResult(await fetchChanges(repoPath), "Fetched successfully", "Failed to fetch");
  });
}

export async function discardAllWorkingChanges(): Promise<void> {
  const repoPath = getRepoPath();
  if (!repoPath) {
    showToast({ message: "No repository open", type: "error" });
    return;
  }

  const confirmed = await showConfirmDialog(
    "Are you sure you want to discard all changes? This cannot be undone.",
    { title: "Discard All Changes", confirmLabel: "Discard" },
  );
  if (!confirmed) return;

  try {
    reportResult(
      await discardAllChanges(repoPath),
      "All changes discarded",
      "Failed to discard changes",
    );
  } catch (error) {
    showToast({ message: `Error: ${error}`, type: "error" });
  }
}
