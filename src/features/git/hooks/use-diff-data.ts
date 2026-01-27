import { useCallback, useEffect, useRef, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { getFileDiff } from "../api/diff";
import type { GitDiff } from "../types/git";

interface UseDiffDataReturn {
  diff: GitDiff | null;
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

  const diffData =
    activeBuffer?.diffData ||
    (activeBuffer?.isDiff && activeBuffer.content
      ? (() => {
          try {
            return JSON.parse(activeBuffer.content) as GitDiff;
          } catch {
            return null;
          }
        })()
      : null);

  const diff = diffData && "file_path" in diffData ? diffData : null;

  const pathMatch = activeBuffer?.path.match(/^diff:\/\/(staged|unstaged)\/(.+)$/);
  const isStaged = pathMatch?.[1] === "staged";
  const encodedFilePath = pathMatch?.[2];
  const filePath = encodedFilePath ? decodeURIComponent(encodedFilePath) : null;

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
            .actions.openBuffer(
              newVirtualPath,
              displayName,
              JSON.stringify(newDiff),
              false,
              false,
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
    if (!rootFolderPath || !filePath || !activeBuffer || isRefreshing.current) {
      return;
    }

    isRefreshing.current = true;
    setIsLoading(true);
    setError(null);

    try {
      const currentViewDiff = await getFileDiff(rootFolderPath, filePath, isStaged);

      if (currentViewDiff && currentViewDiff.lines.length > 0) {
        updateBufferContent(
          activeBuffer.id,
          JSON.stringify(currentViewDiff),
          false,
          currentViewDiff,
        );
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
    filePath,
    isStaged,
    isLoading,
    error,
    refresh,
    switchToView,
  };
};
