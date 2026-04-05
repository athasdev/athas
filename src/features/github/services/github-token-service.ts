// Store GitHub token securely
export const storeGitHubToken = async (token: string): Promise<void> => {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("store_github_token", { token });
  } catch (error) {
    console.error("Error storing GitHub token:", error);
    throw error;
  }
};

// Remove GitHub token from storage
export const removeGitHubToken = async (): Promise<void> => {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("remove_github_token");
  } catch (error) {
    console.error("Error removing GitHub token:", error);
    throw error;
  }
};
