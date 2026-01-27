import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { GitDiff } from "../types/git";
import { gitDiffCache } from "../utils/diff-cache";

export const getFileDiff = async (
  repoPath: string,
  filePath: string,
  staged: boolean = false,
  content?: string,
): Promise<GitDiff | null> => {
  try {
    const cached = gitDiffCache.get(repoPath, filePath, staged, content);
    if (cached) {
      return cached;
    }

    const diff = await tauriInvoke<GitDiff>("git_diff_file", {
      repoPath,
      filePath,
      staged,
    });

    if (diff) {
      gitDiffCache.set(repoPath, filePath, staged, diff, content);
    }

    return diff;
  } catch (error) {
    console.error("Failed to get file diff:", error);
    return null;
  }
};

export const getFileDiffAgainstContent = async (
  repoPath: string,
  filePath: string,
  content: string,
  base: "head" | "index" = "head",
): Promise<GitDiff | null> => {
  try {
    const cached = gitDiffCache.get(repoPath, filePath, base === "index", content);
    if (cached) {
      return cached;
    }

    const diff = await tauriInvoke<GitDiff>("git_diff_file_with_content", {
      repoPath,
      filePath,
      content,
      base,
    });

    if (diff) {
      gitDiffCache.set(repoPath, filePath, base === "index", diff, content);
    }

    return diff;
  } catch (error) {
    console.error("Failed to get file diff against content:", error);
    return null;
  }
};

export const getCommitDiff = async (
  repoPath: string,
  commitHash: string,
): Promise<GitDiff[] | null> => {
  try {
    const diffs = await tauriInvoke<GitDiff[]>("git_commit_diff", {
      repoPath,
      commitHash,
    });
    return diffs;
  } catch (error) {
    console.error("Failed to get commit diff:", error);
    return null;
  }
};

export const getStashDiff = async (
  repoPath: string,
  stashIndex: number,
): Promise<GitDiff[] | null> => {
  try {
    const diffs = await tauriInvoke<GitDiff[]>("git_stash_diff", { repoPath, stashIndex });
    return diffs;
  } catch (error) {
    console.error("Failed to get stash diff:", error);
    return null;
  }
};
