interface GitCacheInvalidation {
  repoPath?: string;
  filePath?: string;
  scopes?: string[];
}

type GitCacheInvalidator = (invalidation: GitCacheInvalidation) => void;

/** Keyed by a stable id, so a module that runs again (hot reload) replaces its invalidator. */
const invalidators = new Map<string, GitCacheInvalidator>();

export function registerGitCacheInvalidator(
  id: string,
  invalidator: GitCacheInvalidator,
): () => void {
  invalidators.set(id, invalidator);
  return () => {
    if (invalidators.get(id) === invalidator) invalidators.delete(id);
  };
}

export function invalidateGitCaches(invalidation: GitCacheInvalidation = {}): void {
  for (const invalidator of invalidators.values()) {
    invalidator(invalidation);
  }
}
