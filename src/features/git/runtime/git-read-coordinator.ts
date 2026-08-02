import { registerGitCacheInvalidator } from "./git-cache-registry";

const inFlightReads = new Map<string, Promise<unknown>>();
const repositoryGenerations = new Map<string, number>();

const getGeneration = (repoPath: string) => {
  const generation = repositoryGenerations.get(repoPath) ?? 0;
  if (!repositoryGenerations.has(repoPath)) {
    repositoryGenerations.set(repoPath, generation);
  }
  return generation;
};

registerGitCacheInvalidator(({ repoPath, scopes }) => {
  if (scopes?.length === 1 && scopes[0] === "working-tree") {
    return;
  }

  if (!repoPath) {
    inFlightReads.clear();
    for (const [cachedRepoPath, generation] of repositoryGenerations) {
      repositoryGenerations.set(cachedRepoPath, generation + 1);
    }
    return;
  }

  repositoryGenerations.set(repoPath, getGeneration(repoPath) + 1);
  const prefix = JSON.stringify([repoPath]).slice(0, -1);
  for (const key of inFlightReads.keys()) {
    if (key.startsWith(prefix)) {
      inFlightReads.delete(key);
    }
  }
});

export function runGitRead<T>(
  repoPath: string,
  queryKey: string,
  read: () => Promise<T>,
): Promise<T> {
  const key = JSON.stringify([repoPath, queryKey]);
  const existing = inFlightReads.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const generation = getGeneration(repoPath);
  const request = read()
    .then((value) => {
      if (generation !== getGeneration(repoPath)) {
        return runGitRead(repoPath, queryKey, read);
      }
      return value;
    })
    .finally(() => {
      if (inFlightReads.get(key) === request) {
        inFlightReads.delete(key);
      }
    });
  inFlightReads.set(key, request);
  return request;
}
