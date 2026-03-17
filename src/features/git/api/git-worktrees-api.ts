import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { GitWorktree } from "../types/git-types";

export const getWorktrees = async (repoPath: string): Promise<GitWorktree[]> => {
  try {
    return await tauriInvoke<GitWorktree[]>("git_get_worktrees", { repoPath });
  } catch (error) {
    console.error("Failed to get worktrees:", error);
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
    await tauriInvoke("git_add_worktree", { repoPath, path, branch, createBranch });
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
    await tauriInvoke("git_remove_worktree", { repoPath, path, force });
    return true;
  } catch (error) {
    console.error("Failed to remove worktree:", error);
    return false;
  }
};

export const pruneWorktrees = async (repoPath: string): Promise<boolean> => {
  try {
    await tauriInvoke("git_prune_worktrees", { repoPath });
    return true;
  } catch (error) {
    console.error("Failed to prune worktrees:", error);
    return false;
  }
};
