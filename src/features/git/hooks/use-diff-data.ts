import { useCallback, useEffect, useRef, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { getFileDiff } from "../api/diff";
import type { MultiFileDiff } from "../types/diff";
import type { GitDiff } from "../types/git";

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

export const useDiffData = (): UseDiffDataReturn => {
  const buffers = useBufferStore.use.buffers();
  const activeBufferId = useBufferStore.use.activeBufferId();
  const activeBuffer = buffers.find((b) => b.id === activeBufferId) || null;
  const { updateBufferContent, closeBuffer } = useBufferStore.use.actions();
  const { rootFolderPath } = useFileSystemStore();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRefreshing = useRef(false);

  const rawDiffData: GitDiff | MultiFileDiff | null =
    activeBuffer?.diffData ||
    (activeBuffer?.isDiff && activeBuffer.content
      ? (() => {
          try {
            return JSON.parse(activeBuffer.content) as GitDiff | MultiFileDiff;
          } catch {
            return null;
          }
        })()
      : null);

  const diff = rawDiffData && "file_path" in rawDiffData ? rawDiffData : null;

  const stagedMatch = activeBuffer?.path.match(/^diff:\/\/(staged|unstaged)\/(.+)$/);
  const commitMatch = activeBuffer?.path.match(/^diff:\/\/commit\/[^/]+\/(.+?)(?:\.diff)?$/);
  const stashMatch = activeBuffer?.path.match(/^diff:\/\/stash\/\d+\/(.+)$/);

  const isStaged = stagedMatch?.[1] === "staged";
  const encodedFilePath = stagedMatch?.[2];
  const filePath = encodedFilePath
    ? decodeURIComponent(encodedFilePath)
    : commitMatch?.[1] && commitMatch[1] !== "all-files"
      ? decodeURIComponent(commitMatch[1])
      : stashMatch?.[1] && stashMatch[1] !== "all-files"
        ? decodeURIComponent(stashMatch[1])
        : null;

  const switchToView = useCallback(
    (viewType: "staged" | "unstaged") => {
      if (!filePath) return;

      const encodedPath = encodeURIComponent(filePath);
      const newVirtualPath = `diff://${viewType}/${encodedPath}`;
      const displayName = `${filePath.split("/").pop()} (${viewType})`;

      getFileDiff(rootFolderPath!, filePath, viewType === "staged").then((newDiff) => {
        if (newDiff && newDiff.lines.length > 0) {
          useBufferStore
            .getState()
            .actions.openBuffer(newVirtualPath, displayName, "", false, false, true, true, newDiff);
        }
      });
    },
    [filePath, rootFolderPath],
  );

  const refresh = useCallback(async () => {
    if (!rootFolderPath || !filePath || !activeBuffer || isRefreshing.current) {
      return;
    }

    isRefreshing.current = true;
    setIsLoading(true);
    setError(null);

    try {
      const currentViewDiff = await getFileDiff(rootFolderPath, filePath, isStaged);

      if (currentViewDiff && currentViewDiff.lines.length > 0) {
        updateBufferContent(activeBuffer.id, "", false, currentViewDiff);
      } else {
        const otherViewDiff = await getFileDiff(rootFolderPath, filePath, !isStaged);

        if (otherViewDiff && otherViewDiff.lines.length > 0) {
          switchToView(isStaged ? "unstaged" : "staged");
          setTimeout(() => closeBuffer(activeBuffer.id), 100);
        } else {
          closeBuffer(activeBuffer.id);
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
    activeBuffer,
    updateBufferContent,
    closeBuffer,
    switchToView,
  ]);

  useEffect(() => {
    const handleGitStatusChanged = async () => {
      if (!rootFolderPath || !filePath || !activeBuffer) return;

      if (isRefreshing.current) return;

      setTimeout(() => {
        if (!isRefreshing.current) {
          refresh();
        }
      }, 50);
    };

    window.addEventListener("git-status-changed", handleGitStatusChanged);
    return () => {
      window.removeEventListener("git-status-changed", handleGitStatusChanged);
    };
  }, [refresh, rootFolderPath, filePath, activeBuffer]);

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
