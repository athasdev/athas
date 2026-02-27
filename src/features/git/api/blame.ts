import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { GitBlame } from "../types/git";
import { isNotGitRepositoryError, resolveRepositoryForFile } from "./repo";

export const getGitBlame = async (rootPath: string, filePath: string): Promise<GitBlame | null> => {
  try {
    const resolved = await resolveRepositoryForFile(rootPath, filePath);
    if (!resolved) {
      return null;
    }

    const blame = await tauriInvoke<GitBlame>("git_blame_file", {
      rootPath: resolved.repoPath,
      filePath: resolved.filePath,
    });
    return blame;
  } catch (error) {
    if (!isNotGitRepositoryError(error)) {
      console.error("Failed to get git blame:", error);
    }
    return null;
  }
};
