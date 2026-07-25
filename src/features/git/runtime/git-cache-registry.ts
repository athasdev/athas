export interface GitCacheInvalidation {
  repoPath?: string;
  filePath?: string;
  scopes?: string[];
}

type GitCacheInvalidator = (invalidation: GitCacheInvalidation) => void;

const invalidators = new Set<GitCacheInvalidator>();

export function registerGitCacheInvalidator(invalidator: GitCacheInvalidator): () => void {
  invalidators.add(invalidator);
  return () => invalidators.delete(invalidator);
}

export function invalidateGitCaches(invalidation: GitCacheInvalidation = {}): void {
  for (const invalidator of invalidators) {
    invalidator(invalidation);
  }
}
