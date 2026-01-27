import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { GitBlame } from "../types/git";

export const getGitBlame = async (rootPath: string, filePath: string): Promise<GitBlame | null> => {
  try {
    const blame = await tauriInvoke<GitBlame>("git_blame_file", {
      rootPath,
      filePath,
    });
    return blame;
  } catch (error) {
    console.error("Failed to get git blame:", error);
    return null;
  }
};
