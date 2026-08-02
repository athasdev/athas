import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { emitGitChanged } from "../events/git-events";
import { runGitRead } from "../runtime/git-read-coordinator";
import {
  isNotGitRepositoryError,
  resolveRepositoryPath,
  resolveRepositoryPathOrThrow,
} from "./git-repo-api";

interface CheckoutResult {
  success: boolean;
  hasChanges: boolean;
  message: string;
}

export const getBranches = async (repoPath: string): Promise<string[]> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPath(repoPath);
    if (!resolvedRepoPath) {
      return [];
    }

    return await runGitRead(resolvedRepoPath, "branches", () =>
      tauriInvoke<string[]>("git_branches", { repoPath: resolvedRepoPath }),
    );
  } catch (error) {
    if (!isNotGitRepositoryError(error)) {
      console.error("Failed to get branches:", error);
    }
    return [];
  }
};

export const checkoutBranch = async (
  repoPath: string,
  branchName: string,
): Promise<CheckoutResult> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPathOrThrow(repoPath);
    const result = await tauriInvoke<CheckoutResult>("git_checkout", {
      repoPath: resolvedRepoPath,
      branchName,
    });
    if (result.success) {
      emitGitChanged({
        repoPath: resolvedRepoPath,
        scopes: ["working-tree", "history", "refs"],
        source: "checkout-branch",
      });
    }
    return result;
  } catch (error) {
    console.error("Failed to checkout branch:", error);
    return {
      success: false,
      hasChanges: false,
      message: "Failed to checkout branch",
    };
  }
};

export const createBranch = async (
  repoPath: string,
  branchName: string,
  fromBranch?: string,
): Promise<boolean> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPathOrThrow(repoPath);
    await tauriInvoke("git_create_branch", {
      repoPath: resolvedRepoPath,
      branchName,
      fromBranch,
    });
    emitGitChanged({
      repoPath: resolvedRepoPath,
      scopes: ["refs"],
      source: "create-branch",
    });
    return true;
  } catch (error) {
    console.error("Failed to create branch:", error);
    return false;
  }
};

export const deleteBranch = async (repoPath: string, branchName: string): Promise<boolean> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPathOrThrow(repoPath);
    await tauriInvoke("git_delete_branch", { repoPath: resolvedRepoPath, branchName });
    emitGitChanged({
      repoPath: resolvedRepoPath,
      scopes: ["refs"],
      source: "delete-branch",
    });
    return true;
  } catch (error) {
    console.error("Failed to delete branch:", error);
    return false;
  }
};
