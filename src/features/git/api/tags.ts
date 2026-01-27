import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { GitTag } from "../types/git";

export const getTags = async (repoPath: string): Promise<GitTag[]> => {
  try {
    const tags = await tauriInvoke<GitTag[]>("git_get_tags", { repoPath });
    return tags;
  } catch (error) {
    console.error("Failed to get tags:", error);
    return [];
  }
};

export const createTag = async (
  repoPath: string,
  name: string,
  message?: string,
  commit?: string,
): Promise<boolean> => {
  try {
    await tauriInvoke("git_create_tag", { repoPath, name, message, commit });
    return true;
  } catch (error) {
    console.error("Failed to create tag:", error);
    return false;
  }
};

export const deleteTag = async (repoPath: string, name: string): Promise<boolean> => {
  try {
    await tauriInvoke("git_delete_tag", { repoPath, name });
    return true;
  } catch (error) {
    console.error("Failed to delete tag:", error);
    return false;
  }
};
