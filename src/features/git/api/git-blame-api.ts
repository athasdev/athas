import { commands } from "@/bindings/commands";
import type { GitBlame } from "../types/git.types";
import { isNotGitRepositoryError, resolveRepositoryForFile } from "./git-repo-api";

export interface ResolvedGitBlame {
  blame: GitBlame;
  repoPath: string;
  filePath: string;
}

export const getResolvedGitBlame = async (
  rootPath: string,
  filePath: string,
  content: string,
): Promise<ResolvedGitBlame | null> => {
  try {
    const resolved = await resolveRepositoryForFile(rootPath, filePath);
    if (!resolved) {
      return null;
    }

    const blame = await commands.gitBlameFile(resolved.repoPath, resolved.filePath, content);
    return {
      blame,
      repoPath: resolved.repoPath,
      filePath: resolved.filePath,
    };
  } catch (error) {
    if (!isNotGitRepositoryError(error)) {
      console.error("Failed to get git blame:", error);
    }
    return null;
  }
};

export const getGitBlame = async (
  rootPath: string,
  filePath: string,
  content: string,
): Promise<GitBlame | null> => {
  return (await getResolvedGitBlame(rootPath, filePath, content))?.blame ?? null;
};
