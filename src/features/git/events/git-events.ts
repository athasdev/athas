import { invalidateGitCaches } from "../runtime/git-cache-registry";

const GIT_CHANGED_EVENT = "athas:git-changed";

export type GitChangeScope =
  | "working-tree"
  | "history"
  | "refs"
  | "remotes"
  | "stashes"
  | "repository";

export interface GitChange {
  repoPath?: string;
  filePath?: string;
  scopes?: GitChangeScope[];
  source?: string;
}

const PASSIVE_GIT_CHANGE_SOURCES = new Set(["save", "auto-save", "external-file-change"]);

export function emitGitChanged(change: GitChange = {}): void {
  invalidateGitCaches(change);

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<GitChange>(GIT_CHANGED_EVENT, { detail: change }));
  }
}

export function subscribeToGitChanges(listener: (change: GitChange) => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleChange = (event: Event) => {
    listener((event as CustomEvent<GitChange>).detail ?? {});
  };

  window.addEventListener(GIT_CHANGED_EVENT, handleChange);
  return () => window.removeEventListener(GIT_CHANGED_EVENT, handleChange);
}

export function isPassiveGitChange(change: GitChange): boolean {
  return !!change.source && PASSIVE_GIT_CHANGE_SOURCES.has(change.source);
}

export function isGitChangeRelevant(
  change: GitChange,
  repoPath: string | null | undefined,
  filePath?: string | null,
): boolean {
  if (change.repoPath && repoPath) {
    const changedRepoPath = change.repoPath.replace(/\\/g, "/").replace(/\/+$/, "");
    const targetRepoPath = repoPath.replace(/\\/g, "/").replace(/\/+$/, "");
    const repositoriesOverlap =
      changedRepoPath === targetRepoPath ||
      changedRepoPath.startsWith(`${targetRepoPath}/`) ||
      targetRepoPath.startsWith(`${changedRepoPath}/`);
    if (!repositoriesOverlap) {
      return false;
    }
  }

  if (!change.filePath || !filePath) {
    return true;
  }

  return (
    change.filePath === filePath ||
    filePath.endsWith(`/${change.filePath}`) ||
    change.filePath.endsWith(`/${filePath}`)
  );
}
