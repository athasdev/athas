import { useBufferStore } from "@/features/editor/stores/buffer.store";
import {
  loadWorkingTreeDiffsProgressively,
  type WorkingTreeDiffEntry,
  type WorkingTreeDiffScope,
} from "@/features/git/services/working-tree-diff-loader";
import type { MultiFileDiff } from "@/features/git/types/git-diff.types";
import type { GitFile } from "@/features/git/types/git.types";

export const WORKING_TREE_TITLES: Record<WorkingTreeDiffScope, string> = {
  all: "Uncommitted Changes",
  unstaged: "Unstaged Changes",
  staged: "Staged Changes",
};

export const WORKING_TREE_EMPTY_LABELS: Record<WorkingTreeDiffScope, string> = {
  all: "tracked changes",
  unstaged: "unstaged tracked changes",
  staged: "staged changes",
};

export function getWorkingTreeDiffEntries(
  files: GitFile[],
  scope: WorkingTreeDiffScope = "all",
): WorkingTreeDiffEntry[] {
  const seen = new Set<string>();
  const entries: WorkingTreeDiffEntry[] = [];

  for (const file of files) {
    if (file.status === "untracked") continue;
    if (scope === "staged" && !file.staged) continue;
    if (scope === "unstaged" && file.staged) continue;

    const key = `${file.staged ? "staged" : "unstaged"}:${file.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push([key, file]);
  }

  return entries;
}

export function openWorkingTreeDiffBuffer({
  repoPath,
  files,
  scope = "all",
  reviewSession,
}: {
  repoPath: string;
  files: GitFile[];
  scope?: WorkingTreeDiffScope;
  reviewSession?: MultiFileDiff["reviewSession"];
}): string | null {
  const diffEntries = getWorkingTreeDiffEntries(files, scope);
  if (diffEntries.length === 0) return null;

  const title = WORKING_TREE_TITLES[scope];
  const multiDiff: MultiFileDiff = {
    title,
    repoPath,
    commitHash: "working-tree",
    files: [],
    totalFiles: 0,
    totalAdditions: 0,
    totalDeletions: 0,
    fileKeys: [],
    isLoading: true,
    indexingProgress: {
      processed: 0,
      total: diffEntries.length,
      label: "Indexing",
    },
    reviewSession,
  };
  const bufferId = useBufferStore
    .getState()
    .actions.openBuffer(
      `diff://working-tree/${scope}`,
      title,
      "",
      false,
      undefined,
      true,
      true,
      multiDiff,
    );

  void loadWorkingTreeDiffsProgressively({
    repoPath,
    bufferId,
    title,
    diffEntries,
  });
  return bufferId;
}
