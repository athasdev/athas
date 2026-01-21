import { invoke as tauriInvoke } from "@tauri-apps/api/core";

interface CheckoutResult {
  success: boolean;
  hasChanges: boolean;
  message: string;
}

export const getBranches = async (repoPath: string): Promise<string[]> => {
  try {
    const branches = await tauriInvoke<string[]>("git_branches", { repoPath });
    return branches;
  } catch (error) {
    console.error("Failed to get branches:", error);
    return [];
  }
};

export const checkoutBranch = async (
  repoPath: string,
  branchName: string,
): Promise<CheckoutResult> => {
  try {
    const result = await tauriInvoke<CheckoutResult>("git_checkout", {
      repoPath,
      branchName,
    });
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
    await tauriInvoke("git_create_branch", {
      repoPath,
      branchName,
      fromBranch,
    });
    return true;
  } catch (error) {
    console.error("Failed to create branch:", error);
    return false;
  }
};

export const deleteBranch = async (repoPath: string, branchName: string): Promise<boolean> => {
  try {
    await tauriInvoke("git_delete_branch", { repoPath, branchName });
    return true;
  } catch (error) {
    console.error("Failed to delete branch:", error);
    return false;
  }
};
