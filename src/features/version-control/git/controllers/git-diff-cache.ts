import type { GitDiff } from "../models/git-types";

interface CacheEntry {
  diff: GitDiff;
  timestamp: number;
  contentHash: string;
}

class GitDiffCache {
  private cache = new Map<string, CacheEntry>();
  private readonly CACHE_TTL = 30000; // 30 seconds
  private readonly MAX_ENTRIES = 100; // Limit cache size

  private generateCacheKey(repoPath: string, filePath: string, staged: boolean): string {
    return `${repoPath}:${filePath}:${staged}`;
  }

  private generateContentHash(content: string): string {
    // Simple hash function for content comparison
    if (!content) return "";
    let hash = 0;
    for (let i = 0; i < Math.min(content.length, 1000); i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(36);
  }

  get(repoPath: string, filePath: string, staged: boolean, content?: string): GitDiff | null {
    const key = this.generateCacheKey(repoPath, filePath, staged);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    const now = Date.now();

    // Check if entry is expired
    if (now - entry.timestamp > this.CACHE_TTL) {
      this.cache.delete(key);
      return null;
    }

    // If content is provided, check if it matches
    if (content !== undefined) {
      const contentHash = this.generateContentHash(content);
      if (contentHash !== entry.contentHash) {
        // Content changed, invalidate cache
        this.cache.delete(key);
        return null;
      }
    }

    return entry.diff;
  }

  set(repoPath: string, filePath: string, staged: boolean, diff: GitDiff, content?: string): void {
    // Clean up old entries if cache is getting too large
    if (this.cache.size >= this.MAX_ENTRIES) {
      this.cleanup();
    }

    const key = this.generateCacheKey(repoPath, filePath, staged);
    const contentHash = content ? this.generateContentHash(content) : "";

    this.cache.set(key, {
      diff,
      timestamp: Date.now(),
      contentHash,
    });
  }

  invalidate(repoPath: string, filePath?: string): void {
    if (filePath) {
      // Invalidate specific file
      const keys = [`${repoPath}:${filePath}:true`, `${repoPath}:${filePath}:false`];
      keys.forEach((key) => this.cache.delete(key));
    } else {
      // Invalidate all entries for the repo
      const keysToDelete: string[] = [];
      for (const key of this.cache.keys()) {
        if (key.startsWith(`${repoPath}:`)) {
          keysToDelete.push(key);
        }
      }
      keysToDelete.forEach((key) => this.cache.delete(key));
    }
  }

  clear(): void {
    this.cache.clear();
  }

  private cleanup(): void {
    const now = Date.now();
    const entriesToDelete: string[] = [];

    // Remove expired entries
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.CACHE_TTL) {
        entriesToDelete.push(key);
      }
    }

    entriesToDelete.forEach((key) => this.cache.delete(key));

    // If still too many entries, remove oldest ones
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
        contentHashLength: entry.contentHash.length,
      })),
    };
  }
}

// Export singleton instance
export const gitDiffCache = new GitDiffCache();
