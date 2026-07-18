import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { GitHunk, GitStatus } from "../types/git.types";
import {
  isNotGitRepositoryError,
  resolveRepositoryPath,
  resolveRepositoryPathOrThrow,
} from "./git-repo-api";

const inFlightGitStatusRequests = new Map<string, Promise<GitStatus | null>>();

export const getGitStatus = async (repoPath: string): Promise<GitStatus | null> => {
  let resolvedRepoPath: string | null;

  try {
    resolvedRepoPath = await resolveRepositoryPath(repoPath);
  } catch (error) {
    if (!isNotGitRepositoryError(error)) {
      console.error("Failed to get git status:", error);
    }
    return null;
  }

  if (!resolvedRepoPath) {
    return null;
  }

  const existingRequest = inFlightGitStatusRequests.get(resolvedRepoPath);
  if (existingRequest) {
    return existingRequest;
  }

  const request = tauriInvoke<GitStatus>("git_status", { repoPath: resolvedRepoPath })
    .catch((error) => {
      if (!isNotGitRepositoryError(error)) {
        console.error("Failed to get git status:", error);
      }
      return null;
    })
    .finally(() => {
      inFlightGitStatusRequests.delete(resolvedRepoPath);
    });

  inFlightGitStatusRequests.set(resolvedRepoPath, request);
  return request;
};

export const stageFile = async (repoPath: string, filePath: string): Promise<boolean> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPathOrThrow(repoPath);
    await tauriInvoke("git_add", { repoPath: resolvedRepoPath, filePath });
    return true;
  } catch (error) {
    console.error("Failed to stage file:", error);
    return false;
  }
};

export const unstageFile = async (repoPath: string, filePath: string): Promise<boolean> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPathOrThrow(repoPath);
    await tauriInvoke("git_reset", { repoPath: resolvedRepoPath, filePath });
    return true;
  } catch (error) {
    console.error("Failed to unstage file:", error);
    return false;
  }
};

export const stageAllFiles = async (repoPath: string): Promise<boolean> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPathOrThrow(repoPath);
    await tauriInvoke("git_add_all", { repoPath: resolvedRepoPath });
    return true;
  } catch (error) {
    console.error("Failed to stage all files:", error);
    return false;
  }
};

export const unstageAllFiles = async (repoPath: string): Promise<boolean> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPathOrThrow(repoPath);
    await tauriInvoke("git_reset_all", { repoPath: resolvedRepoPath });
    return true;
  } catch (error) {
    console.error("Failed to unstage all files:", error);
    return false;
  }
};

export const stageHunk = async (repoPath: string, hunk: GitHunk): Promise<boolean> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPathOrThrow(repoPath);
    await tauriInvoke("git_stage_hunk", { repoPath: resolvedRepoPath, hunk });
    return true;
  } catch (error) {
    console.error("Failed to stage hunk:", error);
    return false;
  }
};

export const unstageHunk = async (repoPath: string, hunk: GitHunk): Promise<boolean> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPathOrThrow(repoPath);
    await tauriInvoke("git_unstage_hunk", { repoPath: resolvedRepoPath, hunk });
    return true;
  } catch (error) {
    console.error("Failed to unstage hunk:", error);
    return false;
  }
};

export const discardAllChanges = async (repoPath: string): Promise<boolean> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPathOrThrow(repoPath);
    await tauriInvoke("git_discard_all_changes", { repoPath: resolvedRepoPath });
    return true;
  } catch (error) {
    console.error("Failed to discard all changes:", error);
    return false;
  }
};

export const discardFileChanges = async (repoPath: string, filePath: string): Promise<boolean> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPathOrThrow(repoPath);
    await tauriInvoke("git_discard_file_changes", { repoPath: resolvedRepoPath, filePath });
    return true;
  } catch (error) {
    console.error("Failed to discard file changes:", error);
    return false;
  }
};

export const initRepository = async (repoPath: string): Promise<boolean> => {
  try {
    await tauriInvoke("git_init", { repoPath });
    return true;
  } catch (error) {
    console.error("Failed to initialize repository:", error);
    return false;
  }
};
