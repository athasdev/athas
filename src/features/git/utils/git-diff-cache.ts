import type { GitDiff } from "../types/git.types";

interface CacheEntry {
  diff: GitDiff;
  timestamp: number;
  contentFingerprint: string;
}

class GitDiffCache {
  private cache = new Map<string, CacheEntry>();
  private repositoryGenerations = new Map<string, number>();
  private readonly CACHE_TTL = 30000;
  private readonly MAX_ENTRIES = 100;

  private generateCacheKey(repoPath: string, filePath: string, staged: boolean): string {
    return JSON.stringify([repoPath, filePath, staged]);
  }

  private parseCacheKey(key: string): [string, string, boolean] | null {
    try {
      const parsed = JSON.parse(key);
      return Array.isArray(parsed) &&
        typeof parsed[0] === "string" &&
        typeof parsed[1] === "string" &&
        typeof parsed[2] === "boolean"
        ? [parsed[0], parsed[1], parsed[2]]
        : null;
    } catch {
      return null;
    }
  }

  getContentFingerprint(content: string | undefined): string {
    if (content === undefined) return "";

    let hash = 2166136261;
    for (let index = 0; index < content.length; index++) {
      hash ^= content.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }

    return `${content.length}:${(hash >>> 0).toString(36)}`;
  }

  getGeneration(repoPath: string): number {
    const generation = this.repositoryGenerations.get(repoPath) ?? 0;
    if (!this.repositoryGenerations.has(repoPath)) {
      this.repositoryGenerations.set(repoPath, generation);
    }
    return generation;
  }

  get(repoPath: string, filePath: string, staged: boolean, content?: string): GitDiff | null {
    const key = this.generateCacheKey(repoPath, filePath, staged);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    const now = Date.now();

    if (now - entry.timestamp > this.CACHE_TTL) {
      this.cache.delete(key);
      return null;
    }

    if (content !== undefined) {
      const contentFingerprint = this.getContentFingerprint(content);
      if (contentFingerprint !== entry.contentFingerprint) {
        return null;
      }
    }

    return entry.diff;
  }

  set(
    repoPath: string,
    filePath: string,
    staged: boolean,
    diff: GitDiff,
    content?: string,
    expectedGeneration?: number,
  ): boolean {
    if (expectedGeneration !== undefined && expectedGeneration !== this.getGeneration(repoPath)) {
      return false;
    }

    if (this.cache.size >= this.MAX_ENTRIES) {
      this.cleanup();
    }

    const key = this.generateCacheKey(repoPath, filePath, staged);
    const contentFingerprint = this.getContentFingerprint(content);

    this.cache.set(key, {
      diff,
      timestamp: Date.now(),
      contentFingerprint,
    });
    return true;
  }

  invalidate(repoPath: string, filePath?: string): void {
    this.repositoryGenerations.set(repoPath, this.getGeneration(repoPath) + 1);

    if (filePath) {
      const keys = [
        this.generateCacheKey(repoPath, filePath, true),
        this.generateCacheKey(repoPath, filePath, false),
      ];
      keys.forEach((key) => this.cache.delete(key));
    } else {
      const keysToDelete: string[] = [];
      for (const key of this.cache.keys()) {
        if (this.parseCacheKey(key)?.[0] === repoPath) {
          keysToDelete.push(key);
        }
      }
      keysToDelete.forEach((key) => this.cache.delete(key));
    }
  }

  invalidateFile(filePath: string): void {
    const normalizedFilePath = filePath.replace(/\\/g, "/");
    const affectedRepositories = new Set<string>();

    for (const key of this.cache.keys()) {
      const parsed = this.parseCacheKey(key);
      if (!parsed) continue;
      const [repoPath, cachedFilePath] = parsed;
      const absoluteCachedPath = `${repoPath.replace(/\/+$/, "")}/${cachedFilePath.replace(
        /^\/+/,
        "",
      )}`;
      if (
        cachedFilePath === normalizedFilePath ||
        absoluteCachedPath === normalizedFilePath ||
        normalizedFilePath.endsWith(`/${cachedFilePath}`)
      ) {
        this.cache.delete(key);
        affectedRepositories.add(repoPath);
      }
    }

    for (const repoPath of affectedRepositories) {
      this.repositoryGenerations.set(repoPath, this.getGeneration(repoPath) + 1);
    }
  }

  clear(): void {
    this.cache.clear();
    for (const [repoPath, generation] of this.repositoryGenerations) {
      this.repositoryGenerations.set(repoPath, generation + 1);
    }
  }

  private cleanup(): void {
    const now = Date.now();
    const entriesToDelete: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.CACHE_TTL) {
        entriesToDelete.push(key);
      }
    }

    entriesToDelete.forEach((key) => this.cache.delete(key));

    if (this.cache.size >= this.MAX_ENTRIES) {
      const entries = Array.from(this.cache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);

      const toRemove = entries.slice(0, Math.floor(this.MAX_ENTRIES * 0.3));
      toRemove.forEach(([key]) => this.cache.delete(key));
    }
  }

  getStats() {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.entries()).map(([key, entry]) => ({
        key,
        age: Date.now() - entry.timestamp,
        contentFingerprintLength: entry.contentFingerprint.length,
      })),
    };
  }
}

export const gitDiffCache = new GitDiffCache();
