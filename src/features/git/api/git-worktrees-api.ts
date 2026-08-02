import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { GitWorktree } from "../types/git.types";
import { emitGitChanged } from "../events/git-events";
import { runGitRead } from "../runtime/git-read-coordinator";
import {
  isNotGitRepositoryError,
  resolveRepositoryPath,
  resolveRepositoryPathOrThrow,
} from "./git-repo-api";

export const getWorktrees = async (repoPath: string): Promise<GitWorktree[]> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPath(repoPath);
    if (!resolvedRepoPath) {
      return [];
    }

    return await runGitRead(resolvedRepoPath, "worktrees", () =>
      tauriInvoke<GitWorktree[]>("git_get_worktrees", { repoPath: resolvedRepoPath }),
    );
  } catch (error) {
    if (!isNotGitRepositoryError(error)) {
      console.error("Failed to get worktrees:", error);
    }
    return [];
  }
};

export const addWorktree = async (
  repoPath: string,
  path: string,
  branch?: string,
  createBranch: boolean = false,
): Promise<boolean> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPathOrThrow(repoPath);
    await tauriInvoke("git_add_worktree", {
      repoPath: resolvedRepoPath,
      path,
      branch,
      createBranch,
    });
    emitGitChanged({
      repoPath: resolvedRepoPath,
      scopes: ["repository", "refs"],
      source: "add-worktree",
    });
    return true;
  } catch (error) {
    console.error("Failed to add worktree:", error);
    return false;
  }
};

export const removeWorktree = async (
  repoPath: string,
  path: string,
  force: boolean = false,
): Promise<boolean> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPathOrThrow(repoPath);
    await tauriInvoke("git_remove_worktree", { repoPath: resolvedRepoPath, path, force });
    emitGitChanged({
      repoPath: resolvedRepoPath,
      scopes: ["repository", "refs"],
      source: "remove-worktree",
    });
    return true;
  } catch (error) {
    console.error("Failed to remove worktree:", error);
    return false;
  }
};
