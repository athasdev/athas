import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getBufferById } from "@/features/editor/utils/buffer-index";
import { getFileDiff } from "../api/git-diff-api";
import type { MultiFileDiff } from "../types/git-diff.types";
import type { GitDiff, GitFile } from "../types/git.types";
import { countDiffStats } from "../utils/git-diff-helpers";

export type WorkingTreeDiffScope = "all" | "unstaged" | "staged";
export type WorkingTreeDiffEntry = readonly [fileKey: string, file: GitFile];
export type LoadedWorkingTreeDiff = { fileKey: string; diff: GitDiff };

const WORKING_TREE_DIFF_BATCH_SIZE = 8;
const WORKING_TREE_DIFF_FILE_LIMIT = 1_000;
const activeLoads = new Map<string, AbortController>();

const yieldToRenderer = () => new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));

function isBufferLoadCurrent(
  bufferId: string,
  repoPath: string,
  controller: AbortController,
): boolean {
  if (controller.signal.aborted || activeLoads.get(bufferId) !== controller) {
    return false;
  }

  const bufferState = useBufferStore.getState();
  const buffer = getBufferById(bufferState.buffers, bufferId);
  return (
    buffer?.type === "diff" &&
    buffer.diffData != null &&
    "files" in buffer.diffData &&
    buffer.diffData.repoPath === repoPath &&
    buffer.diffData.commitHash === "working-tree"
  );
}

function cancelWorkingTreeDiffLoad(bufferId: string): void {
  const controller = activeLoads.get(bufferId);
  controller?.abort();
  activeLoads.delete(bufferId);
}

export async function loadWorkingTreeDiffsProgressively({
  repoPath,
  bufferId,
  title,
  diffEntries,
  initialDiffs = [],
  initialProcessed = 0,
  initiallyExpandedFileKey,
}: {
  repoPath: string;
  bufferId: string;
  title: string;
  diffEntries: WorkingTreeDiffEntry[];
  initialDiffs?: LoadedWorkingTreeDiff[];
  initialProcessed?: number;
  initiallyExpandedFileKey?: string;
}): Promise<void> {
  cancelWorkingTreeDiffLoad(bufferId);
  const controller = new AbortController();
  activeLoads.set(bufferId, controller);

  const total = initialProcessed + diffEntries.length;
  const diffEntriesToLoad = diffEntries.slice(
    0,
    Math.max(0, WORKING_TREE_DIFF_FILE_LIMIT - initialDiffs.length),
  );
  const loadedDiffs: LoadedWorkingTreeDiff[] = [...initialDiffs];

  const publish = (processed: number, isLoading: boolean) => {
    if (!isBufferLoadCurrent(bufferId, repoPath, controller)) {
      return false;
    }

    const stats = countDiffStats(loadedDiffs.map((item) => item.diff));
    useBufferStore.getState().actions.updateBufferContent(bufferId, "", false, {
      title,
      repoPath,
      commitHash: "working-tree",
      files: loadedDiffs.map((item) => item.diff),
      totalFiles: loadedDiffs.length,
      totalAdditions: stats.additions,
      totalDeletions: stats.deletions,
      fileKeys: loadedDiffs.map((item) => item.fileKey),
      initiallyExpandedFileKey: initiallyExpandedFileKey ?? loadedDiffs[0]?.fileKey,
      isLoading,
      indexingProgress: {
        processed,
        total,
        label: "Indexing",
      },
    } satisfies MultiFileDiff);
    return true;
  };

  if (!publish(initialProcessed, diffEntriesToLoad.length > 0)) {
    cancelWorkingTreeDiffLoad(bufferId);
    return;
  }

  let processed = initialProcessed;
  try {
    for (let index = 0; index < diffEntriesToLoad.length; index += WORKING_TREE_DIFF_BATCH_SIZE) {
      if (!isBufferLoadCurrent(bufferId, repoPath, controller)) break;

      const batch = diffEntriesToLoad.slice(index, index + WORKING_TREE_DIFF_BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async ([fileKey, entry]) => {
          const diff = await getFileDiff(repoPath, entry.path, entry.staged);
          if (
            !diff ||
            (diff.lines.length === 0 && diff.is_image !== true && diff.is_binary !== true)
          ) {
            return null;
          }
          return { fileKey, diff };
        }),
      );

      if (!isBufferLoadCurrent(bufferId, repoPath, controller)) break;

      processed += batch.length;
      loadedDiffs.push(
        ...batchResults.filter((entry): entry is LoadedWorkingTreeDiff => entry !== null),
      );
      if (!publish(processed, index + batch.length < diffEntriesToLoad.length)) break;
      await yieldToRenderer();
    }
  } finally {
    if (activeLoads.get(bufferId) === controller) {
      activeLoads.delete(bufferId);
    }
  }
}
