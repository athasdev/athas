import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getBufferById } from "@/features/editor/utils/buffer-index";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { getFileDiff } from "../api/git-diff-api";
import { isGitChangeRelevant, subscribeToGitChanges } from "../events/git-events";
import type { MultiFileDiff } from "../types/git-diff.types";
import type { GitDiff } from "../types/git.types";
import { getDiffBufferFilePath } from "../utils/diff-buffer-path";
import { hasGitDiffChanges } from "../utils/git-diff-helpers";

interface UseDiffDataReturn {
  diff: GitDiff | null;
  rawDiffData: GitDiff | MultiFileDiff | null;
  filePath: string | null;
  isStaged: boolean;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  switchToView: (viewType: "staged" | "unstaged") => void;
}

export const useDiffData = (bufferId: string): UseDiffDataReturn => {
  const diffBuffer = useBufferStore((state) => {
    return getBufferById(state.buffers, bufferId);
  });
  const { updateBufferContent, closeBuffer } = useBufferStore.use.actions();
  const rootFolderPath = useFileSystemStore.use.rootFolderPath?.();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRefreshing = useRef(false);

  const rawDiffData = useMemo<GitDiff | MultiFileDiff | null>(
    () =>
      (diffBuffer?.type === "diff" && diffBuffer.diffData) ||
      (diffBuffer?.type === "diff" && diffBuffer.content
        ? (() => {
            try {
              return JSON.parse(diffBuffer.content) as GitDiff | MultiFileDiff;
            } catch {
              return null;
            }
          })()
        : null),
    [diffBuffer],
  );

  const diff = rawDiffData && "file_path" in rawDiffData ? rawDiffData : null;

  const stagedMatch = diffBuffer?.path.match(/^diff:\/\/(staged|unstaged)\/(.+)$/);
  const isStaged = stagedMatch?.[1] === "staged";
  const isWorkingTreeFileDiff = Boolean(stagedMatch);
  const filePath = getDiffBufferFilePath(diffBuffer?.path);

  const switchToView = useCallback(
    (viewType: "staged" | "unstaged") => {
      if (!filePath || !rootFolderPath) return;

      const encodedPath = encodeURIComponent(filePath);
      const newVirtualPath = `diff://${viewType}/${encodedPath}`;
      const displayName = `${filePath.split("/").pop()} (${viewType})`;

      getFileDiff(rootFolderPath, filePath, viewType === "staged").then((newDiff) => {
        if (hasGitDiffChanges(newDiff)) {
          useBufferStore
            .getState()
            .actions.openBuffer(
              newVirtualPath,
              displayName,
              "",
              false,
              undefined,
              true,
              true,
              newDiff,
            );
        }
      });
    },
    [filePath, rootFolderPath],
  );

  const refresh = useCallback(async () => {
    if (
      !isWorkingTreeFileDiff ||
      !rootFolderPath ||
      !filePath ||
      !diffBuffer ||
      isRefreshing.current
    ) {
      return;
    }

    isRefreshing.current = true;
    setIsLoading(true);
    setError(null);

    try {
      const currentViewDiff = await getFileDiff(rootFolderPath, filePath, isStaged);

      if (hasGitDiffChanges(currentViewDiff)) {
        updateBufferContent(diffBuffer.id, "", false, currentViewDiff);
      } else {
        const otherViewDiff = await getFileDiff(rootFolderPath, filePath, !isStaged);

        if (hasGitDiffChanges(otherViewDiff)) {
          switchToView(isStaged ? "unstaged" : "staged");
          setTimeout(() => closeBuffer(diffBuffer.id), 100);
        } else {
          closeBuffer(diffBuffer.id);
        }
      }
    } catch (err) {
      console.error("Failed to refresh diff:", err);
      setError(err instanceof Error ? err.message : "Failed to refresh diff");
    } finally {
      setIsLoading(false);
      isRefreshing.current = false;
    }
  }, [
    rootFolderPath,
    filePath,
    isStaged,
    isWorkingTreeFileDiff,
    diffBuffer,
    updateBufferContent,
    closeBuffer,
    switchToView,
  ]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribeToGitChanges((change) => {
      if (!isWorkingTreeFileDiff || !rootFolderPath || !filePath || !diffBuffer) return;
      if (!isGitChangeRelevant(change, rootFolderPath, filePath)) return;

      if (isRefreshing.current) return;

      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!isRefreshing.current) {
          void refresh();
        }
      }, 50);
    });

    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [refresh, rootFolderPath, filePath, diffBuffer, isWorkingTreeFileDiff]);

  return {
    diff,
    rawDiffData,
    filePath,
    isStaged,
    isLoading,
    error,
    refresh,
    switchToView,
  };
};
