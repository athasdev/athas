import { useCallback, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { showAlertDialog } from "@/ui/dialog";
import { getCommitDiff, getFileDiff, getRefDiff, getStashDiff } from "../api/git-diff-api";
import {
  loadWorkingTreeDiffsProgressively,
  type WorkingTreeDiffEntry,
  type WorkingTreeDiffScope,
} from "../services/working-tree-diff-loader";
import type { MultiFileDiff } from "../types/git-diff.types";
import type { GitCommit, GitDiff, GitFile } from "../types/git.types";
import { countDiffStats } from "../utils/git-diff-helpers";
import { createSingleFileWorkingTreeDiff } from "../utils/working-tree-multi-diff";

const WORKING_TREE_TITLES: Record<WorkingTreeDiffScope, string> = {
  all: "Uncommitted Changes",
  unstaged: "Unstaged Changes",
  staged: "Staged Changes",
};

const WORKING_TREE_EMPTY_LABELS: Record<WorkingTreeDiffScope, string> = {
  all: "tracked changes",
  unstaged: "unstaged tracked changes",
  staged: "staged changes",
};

function openDiffBuffer(
  virtualPath: string,
  displayName: string,
  diffData: GitDiff | MultiFileDiff,
) {
  return useBufferStore
    .getState()
    .actions.openBuffer(virtualPath, displayName, "", false, undefined, true, true, diffData);
}

function createMultiFileDiff({
  title,
  repoPath,
  commitHash,
  diffs,
  metadata,
}: {
  title?: string;
  repoPath: string;
  commitHash: string;
  diffs: GitDiff[];
  metadata?: Pick<
    MultiFileDiff,
    "commitMessage" | "commitDescription" | "commitAuthor" | "commitDate"
  >;
}): MultiFileDiff {
  const { additions, deletions } = countDiffStats(diffs);
  return {
    title,
    repoPath,
    commitHash,
    files: diffs,
    totalFiles: diffs.length,
    totalAdditions: additions,
    totalDeletions: deletions,
    ...metadata,
  };
}

function normalizeDisplayedFilePath(filePath: string, side: "old" | "new"): string {
  let actualFilePath = filePath;
  if (filePath.includes(" -> ")) {
    const [oldPath, newPath] = filePath.split(" -> ");
    actualFilePath = side === "new" ? newPath : oldPath;
  }

  const trimmed = actualFilePath.trim();
  return trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed;
}

export function useGitDiffActions({
  activeRepoPath,
  onFileSelect,
  gitFileByPath,
  workingTreeDiffEntriesByScope,
  commitByHash,
  currentBranch,
  onBranchDiffOpened,
}: {
  activeRepoPath: string | null;
  onFileSelect?: (path: string, isDir: boolean) => void;
  gitFileByPath: Map<string, GitFile>;
  workingTreeDiffEntriesByScope: Record<WorkingTreeDiffScope, WorkingTreeDiffEntry[]>;
  commitByHash: Map<string, GitCommit>;
  currentBranch?: string;
  onBranchDiffOpened?: () => void;
}) {
  const [isLoadingCommitDiff, setIsLoadingCommitDiff] = useState(false);
  const [isLoadingBranchDiff, setIsLoadingBranchDiff] = useState(false);

  const openOriginalFile = useCallback(
    async (filePath: string) => {
      if (!activeRepoPath || !onFileSelect) return;

      try {
        const actualFilePath = normalizeDisplayedFilePath(filePath, "new");
        onFileSelect(`${activeRepoPath}/${actualFilePath}`, false);
      } catch (error) {
        console.error("Error opening file:", error);
        await showAlertDialog(`Failed to open file ${filePath}:\n${error}`, "Open File");
      }
    },
    [activeRepoPath, onFileSelect],
  );

  const viewFileDiff = useCallback(
    async (filePath: string, staged = false) => {
      if (!activeRepoPath) return;

      try {
        const actualFilePath = normalizeDisplayedFilePath(filePath, staged ? "new" : "old");
        const file = gitFileByPath.get(actualFilePath);
        if (file?.status === "untracked" && !staged) {
          await openOriginalFile(actualFilePath);
          return;
        }

        const diff = await getFileDiff(activeRepoPath, actualFilePath, staged);
        if (!diff || (diff.lines.length === 0 && !diff.is_image && !diff.is_binary)) {
          await openOriginalFile(actualFilePath);
          return;
        }

        const fileKey = `${staged ? "staged" : "unstaged"}:${actualFilePath}`;
        const selectedDiff = createSingleFileWorkingTreeDiff({
          repoPath: activeRepoPath,
          fileKey,
          diff,
        });

        openDiffBuffer("diff://working-tree/all-files", WORKING_TREE_TITLES.all, selectedDiff);
      } catch (error) {
        console.error("Error getting file diff:", error);
        await showAlertDialog(`Failed to get diff for ${filePath}:\n${error}`, "Git Diff");
      }
    },
    [activeRepoPath, gitFileByPath, openOriginalFile],
  );

  const viewWorkingTreeDiff = useCallback(
    async (scope: WorkingTreeDiffScope = "all") => {
      if (!activeRepoPath) return;

      try {
        const diffEntries = workingTreeDiffEntriesByScope[scope];
        if (diffEntries.length === 0) {
          await showAlertDialog(`No ${WORKING_TREE_EMPTY_LABELS[scope]} with diffs.`, "Git Diff");
          return;
        }

        const title = WORKING_TREE_TITLES[scope];
        const multiDiff: MultiFileDiff = {
          title,
          repoPath: activeRepoPath,
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
        };
        const bufferId = openDiffBuffer(`diff://working-tree/${scope}`, title, multiDiff);

        void loadWorkingTreeDiffsProgressively({
          repoPath: activeRepoPath,
          bufferId,
          title,
          diffEntries,
        });
      } catch (error) {
        console.error("Error getting working tree diff:", error);
        await showAlertDialog(`Failed to get working tree diff:\n${error}`, "Git Diff");
      }
    },
    [activeRepoPath, workingTreeDiffEntriesByScope],
  );

  const viewCommitDiff = useCallback(
    async (commitHash: string, filePath?: string) => {
      if (!activeRepoPath) return;

      setIsLoadingCommitDiff(true);
      try {
        const diffs = await getCommitDiff(activeRepoPath, commitHash);
        if (!diffs?.length) {
          await showAlertDialog(
            `No changes in this commit${filePath ? ` for file ${filePath}` : ""}.`,
            "Git Diff",
          );
          return;
        }

        if (filePath) {
          const diff = diffs.find((item) => item.file_path === filePath) ?? diffs[0];
          const diffFileName = `${diff.file_path.split("/").pop()}.diff`;
          openDiffBuffer(`diff://commit/${commitHash}/${diffFileName}`, diffFileName, diff);
          return;
        }

        const commit = commitByHash.get(commitHash);
        const title = `Commit ${commitHash.substring(0, 7)}`;
        const multiDiff = createMultiFileDiff({
          title,
          repoPath: activeRepoPath,
          commitHash,
          diffs,
          metadata: {
            commitMessage: commit?.message,
            commitDescription: commit?.description,
            commitAuthor: commit?.author,
            commitDate: commit?.date,
          },
        });
        openDiffBuffer(
          `diff://commit/${commitHash}/all-files`,
          `${title} (${diffs.length} files)`,
          multiDiff,
        );
      } catch (error) {
        console.error("Error getting commit diff:", error);
        await showAlertDialog(`Failed to get diff for commit ${commitHash}:\n${error}`, "Git Diff");
      } finally {
        setIsLoadingCommitDiff(false);
      }
    },
    [activeRepoPath, commitByHash],
  );

  const viewStashDiff = useCallback(
    async (stashIndex: number) => {
      if (!activeRepoPath) return;

      try {
        const diffs = await getStashDiff(activeRepoPath, stashIndex);
        if (!diffs?.length) {
          await showAlertDialog("No changes in this stash.", "Git Diff");
          return;
        }

        const commitHash = `stash@{${stashIndex}}`;
        const multiDiff = createMultiFileDiff({
          repoPath: activeRepoPath,
          commitHash,
          diffs,
        });
        openDiffBuffer(
          `diff://stash/${stashIndex}/all-files`,
          `Stash @{${stashIndex}} (${diffs.length} files)`,
          multiDiff,
        );
      } catch (error) {
        console.error("Error getting stash diff:", error);
        await showAlertDialog(
          `Failed to get diff for stash@{${stashIndex}}:\n${error}`,
          "Git Diff",
        );
      }
    },
    [activeRepoPath],
  );

  const viewTagComparison = useCallback(
    async (baseRef: string, targetRef: string, title: string) => {
      if (!activeRepoPath) return;

      try {
        const diffs = await getRefDiff(activeRepoPath, baseRef, targetRef);
        if (!diffs?.length) {
          await showAlertDialog(`No changes between ${baseRef} and ${targetRef}.`, "Git Diff");
          return;
        }

        const multiDiff = createMultiFileDiff({
          title,
          repoPath: activeRepoPath,
          commitHash: `${baseRef}..${targetRef}`,
          diffs,
        });
        openDiffBuffer(
          `diff://tag/${encodeURIComponent(title)}/all-files`,
          `${title} (${diffs.length} files)`,
          multiDiff,
        );
      } catch (error) {
        console.error("Error getting tag comparison:", error);
        await showAlertDialog(
          `Failed to compare ${baseRef} and ${targetRef}:\n${error}`,
          "Git Diff",
        );
      }
    },
    [activeRepoPath],
  );

  const viewBranchDiff = useCallback(
    async (baseBranch: string) => {
      const targetBranch = currentBranch ?? "HEAD";
      if (!activeRepoPath || !baseBranch || baseBranch === targetBranch) return;

      const title = `${baseBranch}..${targetBranch}`;
      setIsLoadingBranchDiff(true);
      try {
        const diffs = await getRefDiff(activeRepoPath, baseBranch, targetBranch);
        if (!diffs?.length) {
          await showAlertDialog(
            `No changes between ${baseBranch} and ${targetBranch}.`,
            "Git Diff",
          );
          return;
        }

        const multiDiff = createMultiFileDiff({
          title,
          repoPath: activeRepoPath,
          commitHash: title,
          diffs,
        });
        openDiffBuffer(
          `diff://branch/${encodeURIComponent(title)}/all-files`,
          `${title} (${diffs.length} files)`,
          multiDiff,
        );
        onBranchDiffOpened?.();
      } catch (error) {
        console.error("Error getting branch comparison:", error);
        await showAlertDialog(
          `Failed to compare ${baseBranch} and ${targetBranch}:\n${error}`,
          "Git Diff",
        );
      } finally {
        setIsLoadingBranchDiff(false);
      }
    },
    [activeRepoPath, currentBranch, onBranchDiffOpened],
  );

  return {
    isLoadingCommitDiff,
    isLoadingBranchDiff,
    openOriginalFile,
    viewFileDiff,
    viewWorkingTreeDiff,
    viewCommitDiff,
    viewStashDiff,
    viewTagComparison,
    viewBranchDiff,
  };
}
