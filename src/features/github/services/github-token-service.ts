import type { GitHubAuthStatus } from "../types/github";

export const storeGitHubPatFallback = async (token: string): Promise<GitHubAuthStatus> => {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<GitHubAuthStatus>("store_github_pat_fallback", { token });
  } catch (error) {
    console.error("Error storing GitHub PAT fallback:", error);
    throw error;
  }
};

export const removeGitHubPatFallback = async (): Promise<GitHubAuthStatus> => {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<GitHubAuthStatus>("remove_github_pat_fallback");
  } catch (error) {
    console.error("Error removing GitHub PAT fallback:", error);
    throw error;
  }
};

export const storeGitHubToken = storeGitHubPatFallback;
export const removeGitHubToken = removeGitHubPatFallback;
