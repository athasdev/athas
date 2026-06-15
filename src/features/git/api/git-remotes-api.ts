import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { GitRemote } from "../types/git.types";
import {
  isNotGitRepositoryError,
  resolveRepositoryPath,
  resolveRepositoryPathOrThrow,
} from "./git-repo-api";

export interface GitRemoteActionResult {
  success: boolean;
  error?: string;
}

export const getRemotes = async (repoPath: string): Promise<GitRemote[]> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPath(repoPath);
    if (!resolvedRepoPath) {
      return [];
    }

    const remotes = await tauriInvoke<GitRemote[]>("git_get_remotes", {
      repoPath: resolvedRepoPath,
    });
    return remotes;
  } catch (error) {
    if (!isNotGitRepositoryError(error)) {
      console.error("Failed to get remotes:", error);
    }
    return [];
  }
};

export const addRemote = async (repoPath: string, name: string, url: string): Promise<boolean> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPathOrThrow(repoPath);
    await tauriInvoke("git_add_remote", { repoPath: resolvedRepoPath, name, url });
    return true;
  } catch (error) {
    console.error("Failed to add remote:", error);
    return false;
  }
};

export const removeRemote = async (repoPath: string, name: string): Promise<boolean> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPathOrThrow(repoPath);
    await tauriInvoke("git_remove_remote", { repoPath: resolvedRepoPath, name });
    return true;
  } catch (error) {
    console.error("Failed to remove remote:", error);
    return false;
  }
};

export const pushChanges = async (
  repoPath: string,
  branch?: string,
  remote: string = "origin",
): Promise<GitRemoteActionResult> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPathOrThrow(repoPath);
    await tauriInvoke("git_push", { repoPath: resolvedRepoPath, branch, remote });
    return { success: true };
  } catch (error) {
    console.error("Failed to push changes:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

export const pullChanges = async (
  repoPath: string,
  branch?: string,
  remote: string = "origin",
): Promise<GitRemoteActionResult> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPathOrThrow(repoPath);
    await tauriInvoke("git_pull", { repoPath: resolvedRepoPath, branch, remote });
    return { success: true };
  } catch (error) {
    console.error("Failed to pull changes:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

export const fetchChanges = async (
  repoPath: string,
  remote?: string,
): Promise<GitRemoteActionResult> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPathOrThrow(repoPath);
    await tauriInvoke("git_fetch", { repoPath: resolvedRepoPath, remote });
    return { success: true };
  } catch (error) {
    console.error("Failed to fetch changes:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
