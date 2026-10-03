import { commands } from "@/bindings/commands";
import type { GitCommit } from "../types/git.types";
import { emitGitChanged } from "../events/git-events";
import { runGitRead } from "../runtime/git-read-coordinator";
import {
  isNotGitRepositoryError,
  resolveRepositoryPath,
  resolveRepositoryPathOrThrow,
} from "./git-repo-api";

export const commitChanges = async (repoPath: string, message: string): Promise<boolean> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPathOrThrow(repoPath);
    await commands.gitCommit(resolvedRepoPath, message);
    emitGitChanged({
      repoPath: resolvedRepoPath,
      scopes: ["working-tree", "history", "refs"],
      source: "commit",
    });
    return true;
  } catch (error) {
    console.error("Failed to commit changes:", error);
    return false;
  }
};

export const getGitLog = async (repoPath: string, limit = 50, skip = 0): Promise<GitCommit[]> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPath(repoPath);
    if (!resolvedRepoPath) {
      return [];
    }

    return await runGitRead(resolvedRepoPath, `log:${limit}:${skip}`, () =>
      commands.gitLog(resolvedRepoPath, limit, skip),
    );
  } catch (error) {
    if (!isNotGitRepositoryError(error)) {
      console.error("Failed to get git log:", error);
    }
    return [];
  }
};
