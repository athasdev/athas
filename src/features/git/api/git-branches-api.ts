import { commands, type CheckoutResult } from "@/bindings/commands";
import { emitGitChanged } from "../events/git-events";
import { runGitRead } from "../runtime/git-read-coordinator";
import {
  isNotGitRepositoryError,
  resolveRepositoryPath,
  resolveRepositoryPathOrThrow,
} from "./git-repo-api";

export const getBranches = async (repoPath: string): Promise<string[]> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPath(repoPath);
    if (!resolvedRepoPath) {
      return [];
    }

    return await runGitRead(resolvedRepoPath, "branches", () =>
      commands.gitBranches(resolvedRepoPath),
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
    const result = await commands.gitCheckout(resolvedRepoPath, branchName);
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
    await commands.gitCreateBranch(resolvedRepoPath, branchName, fromBranch ?? null);
    // Creating a branch also checks it out, so HEAD and the working tree move with it.
    emitGitChanged({
      repoPath: resolvedRepoPath,
      scopes: ["working-tree", "history", "refs"],
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
    await commands.gitDeleteBranch(resolvedRepoPath, branchName);
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
