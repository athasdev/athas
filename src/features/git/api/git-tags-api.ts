import { commands, type CheckoutResult } from "@/bindings/commands";
import type { GitTag } from "../types/git.types";
import { emitGitChanged } from "../events/git-events";
import { runGitRead } from "../runtime/git-read-coordinator";
import {
  isNotGitRepositoryError,
  resolveRepositoryPath,
  resolveRepositoryPathOrThrow,
} from "./git-repo-api";
import type { GitRemoteActionResult } from "./git-remotes-api";

export const getTags = async (repoPath: string): Promise<GitTag[]> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPath(repoPath);
    if (!resolvedRepoPath) {
      return [];
    }

    return await runGitRead(resolvedRepoPath, "tags", () => commands.gitGetTags(resolvedRepoPath));
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
    await commands.gitCreateTag(resolvedRepoPath, name, message ?? null, commit ?? null, signed);
    emitGitChanged({
      repoPath: resolvedRepoPath,
      scopes: ["refs"],
      source: "create-tag",
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
    await commands.gitPushTag(resolvedRepoPath, name, remote);
    emitGitChanged({
      repoPath: resolvedRepoPath,
      scopes: ["refs", "remotes"],
      source: "push-tag",
    });
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
    await commands.gitDeleteRemoteTag(resolvedRepoPath, name, remote);
    emitGitChanged({
      repoPath: resolvedRepoPath,
      scopes: ["refs", "remotes"],
      source: "delete-remote-tag",
    });
    return { success: true };
  } catch (error) {
    console.error("Failed to delete remote tag:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

export const checkoutTag = async (repoPath: string, name: string): Promise<CheckoutResult> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPathOrThrow(repoPath);
    const result = await commands.gitCheckoutTag(resolvedRepoPath, name);
    if (result.success) {
      emitGitChanged({
        repoPath: resolvedRepoPath,
        scopes: ["working-tree", "history", "refs"],
        source: "checkout-tag",
      });
    }
    return result;
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
    await commands.gitDeleteTag(resolvedRepoPath, name);
    emitGitChanged({
      repoPath: resolvedRepoPath,
      scopes: ["refs"],
      source: "delete-tag",
    });
    return true;
  } catch (error) {
    console.error("Failed to delete tag:", error);
    return false;
  }
};
