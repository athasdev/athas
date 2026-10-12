import { create } from "zustand";
import { readFileContent } from "@/features/file-system/api/file-operations";
import { toGitDiff } from "@/features/ai/lib/acp-diff-output";
import { getBufferById } from "@/features/editor/stores/buffer-index";
import {
  captureBufferStoreOwner,
  type BufferStoreOwner,
} from "@/features/editor/services/buffer-store-owner";
import { countDiffStats } from "@/features/git/services/git-diff-helpers";
import type { MultiFileDiff } from "@/features/git/types/git-diff.types";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { createSelectors } from "@/utils/zustand-selectors";
import { CLAUDE_CODE_PROPOSAL } from "./claude-diff-proposal";

/** A change Claude Code proposed through `openDiff`, shown in a diff tab until the user decides. */
export interface ClaudeDiffReview {
  requestId: string;
  bufferId: string;
  tabName: string;
  filePath: string;
}

export interface ClaudeDiffRequest {
  requestId: string;
  oldFilePath: string;
  newFilePath: string;
  newContents: string;
  tabName: string;
}

type ClaudeDiffDecision = "accepted" | "rejected";

interface ClaudeDiffReviewState {
  /** Pending reviews by the id of the diff buffer that shows them. */
  reviews: Record<string, ClaudeDiffReview>;
  actions: {
    add: (review: ClaudeDiffReview) => void;
    remove: (bufferId: string) => void;
  };
}

const useClaudeDiffReviewStoreBase = create<ClaudeDiffReviewState>()((set) => ({
  reviews: {},
  actions: {
    add: (review) => set((state) => ({ reviews: { ...state.reviews, [review.bufferId]: review } })),
    remove: (bufferId) =>
      set((state) => {
        if (!(bufferId in state.reviews)) return state;
        const reviews = { ...state.reviews };
        delete reviews[bufferId];
        return { reviews };
      }),
  },
}));

export const useClaudeDiffReviewStore = createSelectors(useClaudeDiffReviewStoreBase);

interface PendingDiff {
  owner: BufferStoreOwner;
  settle: (decision: ClaudeDiffDecision) => void;
  unsubscribe: () => void;
}

const pendingDiffs = new Map<string, PendingDiff>();

async function readDiskText(path: string): Promise<string> {
  try {
    return await readFileContent(path);
  } catch {
    return "";
  }
}

function getBaseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/**
 * Opens Claude's proposed contents for a file as a diff tab and waits for the user. Accepting
 * answers `FILE_SAVED` with the contents, which Claude then writes; rejecting or closing the tab
 * answers `DIFF_REJECTED`.
 */
export async function openClaudeDiff(request: ClaudeDiffRequest): Promise<string[]> {
  const rootFolderPath = useProjectStore.getState().rootFolderPath;
  const oldText = await readDiskText(request.oldFilePath);
  const diff = toGitDiff(
    { path: request.newFilePath, oldText, newText: request.newContents },
    rootFolderPath,
  );
  const { additions, deletions } = countDiffStats([diff]);
  const multiDiff: MultiFileDiff = {
    title: `Claude Code: ${getBaseName(request.newFilePath)}`,
    commitHash: CLAUDE_CODE_PROPOSAL,
    files: [diff],
    totalFiles: 1,
    totalAdditions: additions,
    totalDeletions: deletions,
    fileKeys: [diff.file_path],
    initiallyExpandedFileKey: diff.file_path,
  };

  const owner = captureBufferStoreOwner();
  const bufferId = owner.store
    .getState()
    .actions.openBuffer(
      `diff://claude-code/${request.requestId}`,
      request.tabName,
      "",
      false,
      undefined,
      true,
      true,
      multiDiff,
    );

  return new Promise((resolve) => {
    const unsubscribe = owner.store.subscribe((state) => {
      if (!getBufferById(state.buffers, bufferId)) finishClaudeDiff(bufferId, "rejected");
    });
    pendingDiffs.set(bufferId, {
      owner,
      unsubscribe,
      settle: (decision) =>
        resolve(
          decision === "accepted"
            ? ["FILE_SAVED", request.newContents]
            : ["DIFF_REJECTED", request.tabName],
        ),
    });
    useClaudeDiffReviewStore.getState().actions.add({
      requestId: request.requestId,
      bufferId,
      tabName: request.tabName,
      filePath: request.newFilePath,
    });
  });
}

/** Answers the review shown in `bufferId` (or drops it when `decision` is null) and closes it. */
function finishClaudeDiff(bufferId: string, decision: ClaudeDiffDecision | null): boolean {
  const pending = pendingDiffs.get(bufferId);
  if (!pending) return false;
  pendingDiffs.delete(bufferId);
  pending.unsubscribe();
  useClaudeDiffReviewStore.getState().actions.remove(bufferId);
  if (decision) pending.settle(decision);

  const { buffers, actions } = pending.owner.store.getState();
  if (getBufferById(buffers, bufferId)) actions.closeBufferForce(bufferId);
  return true;
}

export function acceptClaudeDiff(bufferId: string): boolean {
  return finishClaudeDiff(bufferId, "accepted");
}

export function rejectClaudeDiff(bufferId: string): boolean {
  return finishClaudeDiff(bufferId, "rejected");
}

/** Claude stopped waiting for this diff (it disconnected); close the tab without answering. */
export function cancelClaudeDiff(requestId: string): boolean {
  const review = Object.values(useClaudeDiffReviewStore.getState().reviews).find(
    (item) => item.requestId === requestId,
  );
  return review ? finishClaudeDiff(review.bufferId, null) : false;
}

export function closeClaudeDiffByTabName(tabName: string): boolean {
  const review = Object.values(useClaudeDiffReviewStore.getState().reviews).find(
    (item) => item.tabName === tabName,
  );
  return review ? finishClaudeDiff(review.bufferId, "rejected") : false;
}

export function closeAllClaudeDiffs(): number {
  const bufferIds = Object.keys(useClaudeDiffReviewStore.getState().reviews);
  return bufferIds.filter((bufferId) => finishClaudeDiff(bufferId, "rejected")).length;
}
