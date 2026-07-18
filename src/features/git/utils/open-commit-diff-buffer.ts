import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getCommitDiff } from "@/features/git/api/git-diff-api";
import type { MultiFileDiff } from "@/features/git/types/git-diff.types";
import { countDiffStats } from "@/features/git/utils/git-diff-helpers";

interface OpenCommitDiffBufferOptions {
  repoPath: string;
  commitHash: string;
  message?: string;
  description?: string;
  author?: string;
  date?: string;
}

export const openCommitDiffBuffer = async ({
  repoPath,
  commitHash,
  message,
  description,
  author,
  date,
}: OpenCommitDiffBufferOptions): Promise<string | null> => {
  const diffs = await getCommitDiff(repoPath, commitHash);
  if (!diffs || diffs.length === 0) {
    return null;
  }

  const shortHash = commitHash.substring(0, 7);
  const { additions, deletions } = countDiffStats(diffs);
  const multiDiff: MultiFileDiff = {
    title: `Commit ${shortHash}`,
    repoPath,
    commitHash,
    commitMessage: message,
    commitDescription: description,
    commitAuthor: author,
    commitDate: date,
    files: diffs,
    totalFiles: diffs.length,
    totalAdditions: additions,
    totalDeletions: deletions,
  };

  const virtualPath = `diff://commit/${commitHash}/all-files`;
  const displayName = `Commit ${shortHash} (${diffs.length} files)`;

  return useBufferStore
    .getState()
    .actions.openBuffer(virtualPath, displayName, "", false, undefined, true, true, multiDiff);
};
