import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { GitStash } from "../types/git.types";
import { emitGitChanged } from "../events/git-events";
import { runGitRead } from "../runtime/git-read-coordinator";
import {
  isNotGitRepositoryError,
  resolveRepositoryPath,
  resolveRepositoryPathOrThrow,
} from "./git-repo-api";

export const getStashes = async (repoPath: string): Promise<GitStash[]> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPath(repoPath);
    if (!resolvedRepoPath) {
      return [];
    }

    return await runGitRead(resolvedRepoPath, "stashes", () =>
      tauriInvoke<GitStash[]>("git_get_stashes", {
        repoPath: resolvedRepoPath,
      }),
    );
  } catch (error) {
    if (!isNotGitRepositoryError(error)) {
      console.error("Failed to get stashes:", error);
    }
    return [];
  }
};

export const createStash = async (
  repoPath: string,
  message?: string,
  includeUntracked: boolean = false,
  files?: string[],
): Promise<boolean> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPathOrThrow(repoPath);
    await tauriInvoke("git_create_stash", {
      repoPath: resolvedRepoPath,
      message,
      includeUntracked,
      files,
    });
    emitGitChanged({
      repoPath: resolvedRepoPath,
      scopes: ["working-tree", "stashes"],
      source: "create-stash",
    });
    return true;
  } catch (error) {
    console.error("Failed to create stash:", error);
    return false;
  }
};

export const applyStash = async (repoPath: string, stashIndex: number): Promise<boolean> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPathOrThrow(repoPath);
    await tauriInvoke("git_apply_stash", { repoPath: resolvedRepoPath, stashIndex });
    emitGitChanged({
      repoPath: resolvedRepoPath,
      scopes: ["working-tree"],
      source: "apply-stash",
    });
    return true;
  } catch (error) {
    console.error("Failed to apply stash:", error);
    return false;
  }
};

export const popStash = async (repoPath: string, stashIndex?: number): Promise<boolean> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPathOrThrow(repoPath);
    await tauriInvoke("git_pop_stash", { repoPath: resolvedRepoPath, stashIndex });
    emitGitChanged({
      repoPath: resolvedRepoPath,
      scopes: ["working-tree", "stashes"],
      source: "pop-stash",
    });
    return true;
  } catch (error) {
    console.error("Failed to pop stash:", error);
    return false;
  }
};

export const dropStash = async (repoPath: string, stashIndex: number): Promise<boolean> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPathOrThrow(repoPath);
    await tauriInvoke("git_drop_stash", { repoPath: resolvedRepoPath, stashIndex });
    emitGitChanged({
      repoPath: resolvedRepoPath,
      scopes: ["stashes"],
      source: "drop-stash",
    });
    return true;
  } catch (error) {
    console.error("Failed to drop stash:", error);
    return false;
  }
};
