import { invoke as tauriInvoke } from "@tauri-apps/api/core";

export interface GitFile {
  path: string;
  status: "modified" | "added" | "deleted" | "untracked" | "renamed";
  staged: boolean;
}

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  files: GitFile[];
}

export interface GitCommit {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export interface GitDiffLine {
  line_type: "added" | "removed" | "context" | "header";
  content: string;
  old_line_number?: number;
  new_line_number?: number;
}

export interface GitDiff {
  file_path: string;
  old_path?: string;
  new_path?: string;
  is_new: boolean;
  is_deleted: boolean;
  is_renamed: boolean;
  lines: GitDiffLine[];
  is_binary?: boolean;
  is_image?: boolean;
  old_blob_base64?: string;
  new_blob_base64?: string;
}

export const getGitStatus = async (repoPath: string): Promise<GitStatus | null> => {
  try {
    const status = await tauriInvoke<GitStatus>("git_status", { repoPath });
    return status;
  } catch (error) {
    console.error("Failed to get git status:", error);
    return null;
  }
};

export const stageFile = async (repoPath: string, filePath: string): Promise<boolean> => {
  try {
    await tauriInvoke("git_add", { repoPath, filePath });
    return true;
  } catch (error) {
    console.error("Failed to stage file:", error);
    return false;
  }
};

export const unstageFile = async (repoPath: string, filePath: string): Promise<boolean> => {
  try {
    await tauriInvoke("git_reset", { repoPath, filePath });
    return true;
  } catch (error) {
    console.error("Failed to unstage file:", error);
    return false;
  }
};

export const stageAllFiles = async (repoPath: string): Promise<boolean> => {
  try {
    await tauriInvoke("git_add_all", { repoPath });
    return true;
  } catch (error) {
    console.error("Failed to stage all files:", error);
    return false;
  }
};

export const unstageAllFiles = async (repoPath: string): Promise<boolean> => {
  try {
    await tauriInvoke("git_reset_all", { repoPath });
    return true;
  } catch (error) {
    console.error("Failed to unstage all files:", error);
    return false;
  }
};

export const commitChanges = async (repoPath: string, message: string): Promise<boolean> => {
  try {
    await tauriInvoke("git_commit", { repoPath, message });
    return true;
  } catch (error) {
    console.error("Failed to commit changes:", error);
    return false;
  }
};

export const getGitLog = async (repoPath: string, limit?: number): Promise<GitCommit[]> => {
  try {
    const commits = await tauriInvoke<GitCommit[]>("git_log", { repoPath, limit });
    return commits;
  } catch (error) {
    console.error("Failed to get git log:", error);
    return [];
  }
};

export const getBranches = async (repoPath: string): Promise<string[]> => {
  try {
    const branches = await tauriInvoke<string[]>("git_get_branches", { repoPath });
    return branches;
  } catch (error) {
    console.error("Failed to get branches:", error);
    return [];
  }
};

export const checkoutBranch = async (repoPath: string, branchName: string): Promise<boolean> => {
  try {
    await tauriInvoke("git_checkout", { repoPath, branchName });
    return true;
  } catch (error) {
    console.error("Failed to checkout branch:", error);
    return false;
  }
};

export const createBranch = async (
  repoPath: string,
  branchName: string,
  fromBranch?: string,
): Promise<boolean> => {
  try {
    await tauriInvoke("git_create_branch", { repoPath, branchName, fromBranch });
    return true;
  } catch (error) {
    console.error("Failed to create branch:", error);
    return false;
  }
};

export const deleteBranch = async (repoPath: string, branchName: string): Promise<boolean> => {
  try {
    await tauriInvoke("git_delete_branch", { repoPath, branchName });
    return true;
  } catch (error) {
    console.error("Failed to delete branch:", error);
    return false;
  }
};

export const getFileDiff = async (
  repoPath: string,
  filePath: string,
  staged: boolean = false,
): Promise<GitDiff | null> => {
  try {
    const diff = await tauriInvoke<GitDiff>("git_get_file_diff", { repoPath, filePath, staged });
    return diff;
  } catch (error) {
    console.error("Failed to get file diff:", error);
    return null;
  }
};

export const getCommitDiff = async (
  repoPath: string,
  commitHash: string,
): Promise<GitDiff[] | null> => {
  try {
    const diffs = await tauriInvoke<GitDiff[]>("git_get_commit_diff", {
      repoPath,
      commitHash,
    });
    return diffs;
  } catch (error) {
    console.error("Failed to get commit diff:", error);
    return null;
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

export const discardAllChanges = async (repoPath: string): Promise<boolean> => {
  try {
    await tauriInvoke("git_discard_all_changes", { repoPath });
    return true;
  } catch (error) {
    console.error("Failed to discard all changes:", error);
    return false;
  }
};

export const discardFileChanges = async (repoPath: string, filePath: string): Promise<boolean> => {
  try {
    await tauriInvoke("git_discard_file_changes", { repoPath, filePath });
    return true;
  } catch (error) {
    console.error("Failed to discard file changes:", error);
    return false;
  }
};

export const initRepository = async (repoPath: string): Promise<boolean> => {
  try {
    await tauriInvoke("git_init", { repoPath });
    return true;
  } catch (error) {
    console.error("Failed to initialize repository:", error);
    return false;
  }
};

export interface GitRemote {
  name: string;
  url: string;
}

export const getRemotes = async (repoPath: string): Promise<GitRemote[]> => {
  try {
    const remotes = await tauriInvoke<GitRemote[]>("git_get_remotes", { repoPath });
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

export interface GitStash {
  index: number;
  message: string;
  date: string;
}

export const getStashes = async (repoPath: string): Promise<GitStash[]> => {
  try {
    const stashes = await tauriInvoke<GitStash[]>("git_get_stashes", { repoPath });
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
): Promise<boolean> => {
  try {
    await tauriInvoke("git_create_stash", { repoPath, message, includeUntracked });
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

export interface GitTag {
  name: string;
  commit: string;
  message?: string;
  date: string;
}

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
