import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { GitStash } from "../types/git";

export const getStashes = async (repoPath: string): Promise<GitStash[]> => {
  try {
    const stashes = await tauriInvoke<GitStash[]>("git_get_stashes", {
      repoPath,
    });
    return stashes;
  } catch (error) {
    console.error("Failed to get stashes:", error);
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
    await tauriInvoke("git_create_stash", {
      repoPath,
      message,
      includeUntracked,
      files,
    });
    return true;
  } catch (error) {
    console.error("Failed to create stash:", error);
    return false;
  }
};

export const applyStash = async (repoPath: string, stashIndex: number): Promise<boolean> => {
  try {
    await tauriInvoke("git_apply_stash", { repoPath, stashIndex });
    return true;
  } catch (error) {
    console.error("Failed to apply stash:", error);
    return false;
  }
};

export const popStash = async (repoPath: string, stashIndex?: number): Promise<boolean> => {
  try {
    await tauriInvoke("git_pop_stash", { repoPath, stashIndex });
    return true;
  } catch (error) {
    console.error("Failed to pop stash:", error);
    return false;
  }
};

export const dropStash = async (repoPath: string, stashIndex: number): Promise<boolean> => {
  try {
    await tauriInvoke("git_drop_stash", { repoPath, stashIndex });
    return true;
  } catch (error) {
    console.error("Failed to drop stash:", error);
    return false;
  }
};
