import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { GitDiff, GitDiffStat } from "../types/git.types";
import { registerGitCacheInvalidator } from "../runtime/git-cache-registry";
import { runGitRead } from "../runtime/git-read-coordinator";
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
const inFlightFileDiffRequests = new Map<string, Promise<GitDiff | null>>();
const inFlightStatusDiffStatsRequests = new Map<string, Promise<GitDiffStat[]>>();
const repositoryCacheGenerations = new Map<string, number>();

const getRepositoryCacheGeneration = (repoPath: string): number => {
  const generation = repositoryCacheGenerations.get(repoPath) ?? 0;
  if (!repositoryCacheGenerations.has(repoPath)) {
    repositoryCacheGenerations.set(repoPath, generation);
  }
  return generation;
};

const getFileDiffRequestKey = (
  repoPath: string,
  filePath: string,
  staged: boolean,
  content?: string,
): string =>
  JSON.stringify([
    repoPath,
    filePath,
    staged,
    content === undefined ? null : gitDiffCache.getContentFingerprint(content),
  ]);

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

export function invalidateGitDiffData(repoPath?: string, filePath?: string): void {
  if (!repoPath) {
    if (filePath) {
      gitDiffCache.invalidateFile(filePath);
      inFlightFileDiffRequests.clear();
      inFlightStatusDiffStatsRequests.clear();
      return;
    }

    commitDiffCache.clear();
    stashDiffCache.clear();
    refDiffCache.clear();
    for (const [cachedRepoPath, generation] of repositoryCacheGenerations) {
      repositoryCacheGenerations.set(cachedRepoPath, generation + 1);
    }
    gitDiffCache.clear();
    inFlightFileDiffRequests.clear();
    inFlightStatusDiffStatsRequests.clear();
    return;
  }

  repositoryCacheGenerations.set(repoPath, getRepositoryCacheGeneration(repoPath) + 1);
  gitDiffCache.invalidate(repoPath, filePath);
  if (filePath) {
    gitDiffCache.invalidateFile(filePath);
  }
  inFlightStatusDiffStatsRequests.delete(repoPath);
  const fileRequestPrefix = JSON.stringify([repoPath]).slice(0, -1);
  for (const key of inFlightFileDiffRequests.keys()) {
    if (key.startsWith(fileRequestPrefix)) {
      inFlightFileDiffRequests.delete(key);
    }
  }

  if (filePath) {
    return;
  }

  const prefix = `${repoPath}:`;
  for (const cache of [commitDiffCache, stashDiffCache, refDiffCache]) {
    for (const key of cache.keys()) {
      if (key.startsWith(prefix)) {
        cache.delete(key);
      }
    }
  }
}

registerGitCacheInvalidator(({ repoPath, filePath }) => {
  invalidateGitDiffData(repoPath, filePath);
});

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

    const requestKey = getFileDiffRequestKey(resolved.repoPath, resolved.filePath, staged, content);
    const existingRequest = inFlightFileDiffRequests.get(requestKey);
    if (existingRequest) {
      return existingRequest;
    }

    const generation = gitDiffCache.getGeneration(resolved.repoPath);
    const request = tauriInvoke<GitDiff>("git_diff_file", {
      repoPath: resolved.repoPath,
      filePath: resolved.filePath,
      staged,
    })
      .then((diff) => {
        if (generation !== gitDiffCache.getGeneration(resolved.repoPath)) {
          return getFileDiff(resolved.repoPath, resolved.filePath, staged, content);
        }

        if (diff) {
          gitDiffCache.set(resolved.repoPath, resolved.filePath, staged, diff, content, generation);
        }

        return diff;
      })
      .catch((error) => {
        if (!isNotGitRepositoryError(error) && !isNoDiffFoundError(error)) {
          console.error("Failed to get file diff:", error);
        }
        return null;
      })
      .finally(() => {
        if (inFlightFileDiffRequests.get(requestKey) === request) {
          inFlightFileDiffRequests.delete(requestKey);
        }
      });

    inFlightFileDiffRequests.set(requestKey, request);
    return request;
  } catch (error) {
    if (!isNotGitRepositoryError(error) && !isNoDiffFoundError(error)) {
      console.error("Failed to get file diff:", error);
    }
    return null;
  }
};

export const getStatusDiffStats = async (repoPath: string): Promise<GitDiffStat[]> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPath(repoPath);
    if (!resolvedRepoPath) {
      return [];
    }

    const existingRequest = inFlightStatusDiffStatsRequests.get(resolvedRepoPath);
    if (existingRequest) {
      return existingRequest;
    }

    const generation = getRepositoryCacheGeneration(resolvedRepoPath);
    const request = tauriInvoke<GitDiffStat[]>("git_status_diff_stats", {
      repoPath: resolvedRepoPath,
    })
      .then((stats) => {
        if (generation !== getRepositoryCacheGeneration(resolvedRepoPath)) {
          return getStatusDiffStats(resolvedRepoPath);
        }
        return stats;
      })
      .catch((error) => {
        if (!isNotGitRepositoryError(error)) {
          console.error("Failed to get status diff stats:", error);
        }
        return [];
      })
      .finally(() => {
        if (inFlightStatusDiffStatsRequests.get(resolvedRepoPath) === request) {
          inFlightStatusDiffStatsRequests.delete(resolvedRepoPath);
        }
      });

    inFlightStatusDiffStatsRequests.set(resolvedRepoPath, request);
    return request;
  } catch (error) {
    if (!isNotGitRepositoryError(error)) {
      console.error("Failed to get status diff stats:", error);
    }
    return [];
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

    const generation = getRepositoryCacheGeneration(resolvedRepoPath);
    const diffs = await runGitRead(resolvedRepoPath, `commit-diff:${commitHash}`, () =>
      tauriInvoke<GitDiff[]>("git_commit_diff", {
        repoPath: resolvedRepoPath,
        commitHash,
      }),
    );
    if (generation !== getRepositoryCacheGeneration(resolvedRepoPath)) {
      return getCommitDiff(resolvedRepoPath, commitHash);
    }
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

    const generation = getRepositoryCacheGeneration(resolvedRepoPath);
    const diffs = await runGitRead(resolvedRepoPath, `ref-diff:${baseRef}:${targetRef}`, () =>
      tauriInvoke<GitDiff[]>("git_ref_diff", {
        repoPath: resolvedRepoPath,
        baseRef,
        targetRef,
      }),
    );
    if (generation !== getRepositoryCacheGeneration(resolvedRepoPath)) {
      return getRefDiff(resolvedRepoPath, baseRef, targetRef);
    }
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

    const generation = getRepositoryCacheGeneration(resolvedRepoPath);
    const diffs = await runGitRead(resolvedRepoPath, `stash-diff:${stashIndex}`, () =>
      tauriInvoke<GitDiff[]>("git_stash_diff", {
        repoPath: resolvedRepoPath,
        stashIndex,
      }),
    );
    if (generation !== getRepositoryCacheGeneration(resolvedRepoPath)) {
      return getStashDiff(resolvedRepoPath, stashIndex);
    }
    setMultiFileDiffCacheEntry(stashDiffCache, cacheKey, diffs);
    return diffs;
  } catch (error) {
    if (!isNotGitRepositoryError(error)) {
      console.error("Failed to get stash diff:", error);
    }
    return null;
  }
};
