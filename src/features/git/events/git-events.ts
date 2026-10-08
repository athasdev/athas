import { emitAppEvent, onAppEvent } from "@/utils/app-events";
import { invalidateGitCaches } from "../runtime/git-cache-registry";

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
  emitAppEvent("athas:git-changed", change);
}

export function subscribeToGitChanges(listener: (change: GitChange) => void): () => void {
  return onAppEvent("athas:git-changed", listener);
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
