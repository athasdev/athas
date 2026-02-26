import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { GitDiff } from "../types/git";
import { gitDiffCache } from "../utils/diff-cache";
import { isNotGitRepositoryError, resolveRepositoryForFile, resolveRepositoryPath } from "./repo";

export const getFileDiff = async (
  repoPath: string,
  filePath: string,
  staged: boolean = false,
  content?: string,
): Promise<GitDiff | null> => {
  try {
    const resolved = await resolveRepositoryForFile(repoPath, filePath);
    if (!resolved) {
      return null;
    }

    const cached = gitDiffCache.get(resolved.repoPath, resolved.filePath, staged, content);
    if (cached) {
      return cached;
    }

    const diff = await tauriInvoke<GitDiff>("git_diff_file", {
      repoPath: resolved.repoPath,
      filePath: resolved.filePath,
      staged,
    });

    if (diff) {
      gitDiffCache.set(resolved.repoPath, resolved.filePath, staged, diff, content);
    }

    return diff;
  } catch (error) {
    if (!isNotGitRepositoryError(error)) {
      console.error("Failed to get file diff:", error);
    }
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
    const resolved = await resolveRepositoryForFile(repoPath, filePath);
    if (!resolved) {
      return null;
    }

    const cached = gitDiffCache.get(
      resolved.repoPath,
      resolved.filePath,
      base === "index",
      content,
    );
    if (cached) {
      return cached;
    }

    const diff = await tauriInvoke<GitDiff>("git_diff_file_with_content", {
      repoPath: resolved.repoPath,
      filePath: resolved.filePath,
      content,
      base,
    });

    if (diff) {
      gitDiffCache.set(resolved.repoPath, resolved.filePath, base === "index", diff, content);
    }

    return diff;
  } catch (error) {
    if (!isNotGitRepositoryError(error)) {
      console.error("Failed to get file diff against content:", error);
    }
    return null;
  }
};

export const getCommitDiff = async (
  repoPath: string,
  commitHash: string,
): Promise<GitDiff[] | null> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPath(repoPath);
    if (!resolvedRepoPath) {
      return null;
    }

    const diffs = await tauriInvoke<GitDiff[]>("git_commit_diff", {
      repoPath: resolvedRepoPath,
      commitHash,
    });
    return diffs;
  } catch (error) {
    if (!isNotGitRepositoryError(error)) {
      console.error("Failed to get commit diff:", error);
    }
    return null;
  }
};

export const getStashDiff = async (
  repoPath: string,
  stashIndex: number,
): Promise<GitDiff[] | null> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPath(repoPath);
    if (!resolvedRepoPath) {
      return null;
    }

    const diffs = await tauriInvoke<GitDiff[]>("git_stash_diff", {
      repoPath: resolvedRepoPath,
      stashIndex,
    });
    return diffs;
  } catch (error) {
    if (!isNotGitRepositoryError(error)) {
      console.error("Failed to get stash diff:", error);
    }
    return null;
  }
};
