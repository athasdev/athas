import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { GitTag } from "../types/git.types";
import {
  isNotGitRepositoryError,
  resolveRepositoryPath,
  resolveRepositoryPathOrThrow,
} from "./git-repo-api";
import type { GitRemoteActionResult } from "./git-remotes-api";

interface CheckoutTagResult {
  success: boolean;
  hasChanges: boolean;
  message: string;
}

export const getTags = async (repoPath: string): Promise<GitTag[]> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPath(repoPath);
    if (!resolvedRepoPath) {
      return [];
    }

    const tags = await tauriInvoke<GitTag[]>("git_get_tags", { repoPath: resolvedRepoPath });
    return tags;
  } catch (error) {
    if (!isNotGitRepositoryError(error)) {
      console.error("Failed to get tags:", error);
    }
    return [];
  }
};

export const createTag = async (
  repoPath: string,
  name: string,
  message?: string,
  commit?: string,
  signed = false,
): Promise<boolean> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPathOrThrow(repoPath);
    await tauriInvoke("git_create_tag", {
      repoPath: resolvedRepoPath,
      name,
      message,
      commit,
      signed,
    });
    return true;
  } catch (error) {
    console.error("Failed to create tag:", error);
    return false;
  }
};

export const pushTag = async (
  repoPath: string,
  name: string,
  remote: string,
): Promise<GitRemoteActionResult> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPathOrThrow(repoPath);
    await tauriInvoke("git_push_tag", { repoPath: resolvedRepoPath, name, remote });
    return { success: true };
  } catch (error) {
    console.error("Failed to push tag:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

export const deleteRemoteTag = async (
  repoPath: string,
  name: string,
  remote: string,
): Promise<GitRemoteActionResult> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPathOrThrow(repoPath);
    await tauriInvoke("git_delete_remote_tag", { repoPath: resolvedRepoPath, name, remote });
    return { success: true };
  } catch (error) {
    console.error("Failed to delete remote tag:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

export const checkoutTag = async (repoPath: string, name: string): Promise<CheckoutTagResult> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPathOrThrow(repoPath);
    return await tauriInvoke<CheckoutTagResult>("git_checkout_tag", {
      repoPath: resolvedRepoPath,
      name,
    });
  } catch (error) {
    console.error("Failed to checkout tag:", error);
    return {
      success: false,
      hasChanges: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
};

export const deleteTag = async (repoPath: string, name: string): Promise<boolean> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPathOrThrow(repoPath);
    await tauriInvoke("git_delete_tag", { repoPath: resolvedRepoPath, name });
    return true;
  } catch (error) {
    console.error("Failed to delete tag:", error);
    return false;
  }
};
