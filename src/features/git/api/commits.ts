import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { GitCommit } from "../types/git";
import { isNotGitRepositoryError, resolveRepositoryPath } from "./repo";

export const commitChanges = async (repoPath: string, message: string): Promise<boolean> => {
  try {
    await tauriInvoke("git_commit", { repoPath, message });
    return true;
  } catch (error) {
    console.error("Failed to commit changes:", error);
    return false;
  }
};

export const getGitLog = async (repoPath: string, limit = 50, skip = 0): Promise<GitCommit[]> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPath(repoPath);
    if (!resolvedRepoPath) {
      return [];
    }

    const commits = await tauriInvoke<GitCommit[]>("git_log", {
      repoPath: resolvedRepoPath,
      limit,
      skip,
    });
    return commits;
  } catch (error) {
    if (!isNotGitRepositoryError(error)) {
      console.error("Failed to get git log:", error);
    }
    return [];
  }
};
