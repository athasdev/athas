import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { GitRemote } from "../types/git";

export const getRemotes = async (repoPath: string): Promise<GitRemote[]> => {
  try {
    const remotes = await tauriInvoke<GitRemote[]>("git_get_remotes", {
      repoPath,
    });
    return remotes;
  } catch (error) {
    console.error("Failed to get remotes:", error);
    return [];
  }
};

export const addRemote = async (repoPath: string, name: string, url: string): Promise<boolean> => {
  try {
    await tauriInvoke("git_add_remote", { repoPath, name, url });
    return true;
  } catch (error) {
    console.error("Failed to add remote:", error);
    return false;
  }
};

export const removeRemote = async (repoPath: string, name: string): Promise<boolean> => {
  try {
    await tauriInvoke("git_remove_remote", { repoPath, name });
    return true;
  } catch (error) {
    console.error("Failed to remove remote:", error);
    return false;
  }
};

export const pushChanges = async (
  repoPath: string,
  branch?: string,
  remote: string = "origin",
): Promise<boolean> => {
  try {
    await tauriInvoke("git_push", { repoPath, branch, remote });
    return true;
  } catch (error) {
    console.error("Failed to push changes:", error);
    return false;
  }
};

export const pullChanges = async (
  repoPath: string,
  branch?: string,
  remote: string = "origin",
): Promise<boolean> => {
  try {
    await tauriInvoke("git_pull", { repoPath, branch, remote });
    return true;
  } catch (error) {
    console.error("Failed to pull changes:", error);
    return false;
  }
};

export const fetchChanges = async (repoPath: string, remote?: string): Promise<boolean> => {
  try {
    await tauriInvoke("git_fetch", { repoPath, remote });
    return true;
  } catch (error) {
    console.error("Failed to fetch changes:", error);
    return false;
  }
};
