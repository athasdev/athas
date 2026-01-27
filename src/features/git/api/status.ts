import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { GitHunk, GitStatus } from "../types/git";

export const getGitStatus = async (repoPath: string): Promise<GitStatus | null> => {
  try {
    const status = await tauriInvoke<GitStatus>("git_status", { repoPath });
    return status;
  } catch (error) {
    console.error("Failed to get git status:", error);
    return null;
  }
};

export const stageFile = async (repoPath: string, filePath: string): Promise<boolean> => {
  try {
    await tauriInvoke("git_add", { repoPath, filePath });
    return true;
  } catch (error) {
    console.error("Failed to stage file:", error);
    return false;
  }
};

export const unstageFile = async (repoPath: string, filePath: string): Promise<boolean> => {
  try {
    await tauriInvoke("git_reset", { repoPath, filePath });
    return true;
  } catch (error) {
    console.error("Failed to unstage file:", error);
    return false;
  }
};

export const stageAllFiles = async (repoPath: string): Promise<boolean> => {
  try {
    await tauriInvoke("git_add_all", { repoPath });
    return true;
  } catch (error) {
    console.error("Failed to stage all files:", error);
    return false;
  }
};

export const unstageAllFiles = async (repoPath: string): Promise<boolean> => {
  try {
    await tauriInvoke("git_reset_all", { repoPath });
    return true;
  } catch (error) {
    console.error("Failed to unstage all files:", error);
    return false;
  }
};

export const stageHunk = async (repoPath: string, hunk: GitHunk): Promise<boolean> => {
  try {
    await tauriInvoke("git_stage_hunk", { repoPath, hunk });
    return true;
  } catch (error) {
    console.error("Failed to stage hunk:", error);
    return false;
  }
};

export const unstageHunk = async (repoPath: string, hunk: GitHunk): Promise<boolean> => {
  try {
    await tauriInvoke("git_unstage_hunk", { repoPath, hunk });
    return true;
  } catch (error) {
    console.error("Failed to unstage hunk:", error);
    return false;
  }
};

export const discardAllChanges = async (repoPath: string): Promise<boolean> => {
  try {
    await tauriInvoke("git_discard_all_changes", { repoPath });
    return true;
  } catch (error) {
    console.error("Failed to discard all changes:", error);
    return false;
  }
};

export const discardFileChanges = async (repoPath: string, filePath: string): Promise<boolean> => {
  try {
    await tauriInvoke("git_discard_file_changes", { repoPath, filePath });
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
