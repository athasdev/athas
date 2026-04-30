import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { GitDiff } from "../types/git-types";
import { gitDiffCache } from "../utils/git-diff-cache";
import {
  isNotGitRepositoryError,
  resolveRepositoryForFile,
  resolveRepositoryPath,
} from "./git-repo-api";

interface MultiFileDiffCacheEntry {
  diffs: GitDiff[];
  timestamp: number;
}

const MULTI_FILE_DIFF_CACHE_TTL = 30_000;
const commitDiffCache = new Map<string, MultiFileDiffCacheEntry>();
const stashDiffCache = new Map<string, MultiFileDiffCacheEntry>();
const refDiffCache = new Map<string, MultiFileDiffCacheEntry>();

const getMultiFileDiffCacheEntry = (
  cache: Map<string, MultiFileDiffCacheEntry>,
  key: string,
): GitDiff[] | null => {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > MULTI_FILE_DIFF_CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return entry.diffs;
};

const setMultiFileDiffCacheEntry = (
  cache: Map<string, MultiFileDiffCacheEntry>,
  key: string,
  diffs: GitDiff[],
): void => {
  cache.set(key, {
    diffs,
    timestamp: Date.now(),
  });
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return "";
};

const isNoDiffFoundError = (error: unknown): boolean => {
  return getErrorMessage(error).includes("No changes found for file:");
};

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
    if (!isNotGitRepositoryError(error) && !isNoDiffFoundError(error)) {
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
    if (!isNotGitRepositoryError(error) && !isNoDiffFoundError(error)) {
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

    const cacheKey = `${resolvedRepoPath}:${commitHash}`;
    const cached = getMultiFileDiffCacheEntry(commitDiffCache, cacheKey);
    if (cached) {
      return cached;
    }

    const diffs = await tauriInvoke<GitDiff[]>("git_commit_diff", {
      repoPath: resolvedRepoPath,
      commitHash,
    });
    setMultiFileDiffCacheEntry(commitDiffCache, cacheKey, diffs);
    return diffs;
  } catch (error) {
    if (!isNotGitRepositoryError(error)) {
      console.error("Failed to get commit diff:", error);
    }
    return null;
  }
};

export const getRefDiff = async (
  repoPath: string,
  baseRef: string,
  targetRef: string,
): Promise<GitDiff[] | null> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPath(repoPath);
    if (!resolvedRepoPath) {
      return null;
    }

    const cacheKey = `${resolvedRepoPath}:${baseRef}:${targetRef}`;
    const cached = getMultiFileDiffCacheEntry(refDiffCache, cacheKey);
    if (cached) {
      return cached;
    }

    const diffs = await tauriInvoke<GitDiff[]>("git_ref_diff", {
      repoPath: resolvedRepoPath,
      baseRef,
      targetRef,
    });
    setMultiFileDiffCacheEntry(refDiffCache, cacheKey, diffs);
    return diffs;
  } catch (error) {
    if (!isNotGitRepositoryError(error)) {
      console.error("Failed to get ref diff:", error);
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

    const cacheKey = `${resolvedRepoPath}:${stashIndex}`;
    const cached = getMultiFileDiffCacheEntry(stashDiffCache, cacheKey);
    if (cached) {
      return cached;
    }

    const diffs = await tauriInvoke<GitDiff[]>("git_stash_diff", {
      repoPath: resolvedRepoPath,
      stashIndex,
    });
    setMultiFileDiffCacheEntry(stashDiffCache, cacheKey, diffs);
    return diffs;
  } catch (error) {
    if (!isNotGitRepositoryError(error)) {
      console.error("Failed to get stash diff:", error);
    }
    return null;
  }
};
