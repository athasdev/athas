import { useCallback, useEffect, useRef, useState } from "react";
import { useFileSystemStore } from "@/file-system/controllers/store";
import { useBufferStore } from "@/stores/buffer-store";
import type { GitDiff } from "@/utils/git";
import { getFileDiff } from "@/utils/git";

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

  // Use ref to track if we're already refreshing to prevent concurrent refreshes
  const isRefreshing = useRef(false);

  // Get diff from buffer or parse from content for backwards compatibility
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

  // Filter out MultiFileDiff since this hook handles single file diffs only
  const diff = diffData && "file_path" in diffData ? diffData : null;

  // Extract file path and staged status from virtual path
  const pathMatch = activeBuffer?.path.match(/^diff:\/\/(staged|unstaged)\/(.+)$/);
  const isStaged = pathMatch?.[1] === "staged";
  const encodedFilePath = pathMatch?.[2];
  const filePath = encodedFilePath ? decodeURIComponent(encodedFilePath) : null;

  // Helper to switch to a different view (staged/unstaged)
  const switchToView = useCallback(
    (viewType: "staged" | "unstaged") => {
      if (!filePath) return;

      const encodedPath = encodeURIComponent(filePath);
      const newVirtualPath = `diff://${viewType}/${encodedPath}`;
      const displayName = `${filePath.split("/").pop()} (${viewType})`;

      // Get the diff data for the new view
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

  // Refresh diff data with debouncing and optimistic updates
  const refresh = useCallback(async () => {
    if (!rootFolderPath || !filePath || !activeBuffer || isRefreshing.current) {
      return;
    }

    isRefreshing.current = true;
    setIsLoading(true);
    setError(null);

    try {
      // Get the diff for current view
      const currentViewDiff = await getFileDiff(rootFolderPath, filePath, isStaged);

      if (currentViewDiff && currentViewDiff.lines.length > 0) {
        // Update buffer with new diff data for current view
        updateBufferContent(
          activeBuffer.id,
          JSON.stringify(currentViewDiff),
          false,
          currentViewDiff,
        );
      } else {
        // Current view has no changes, check the other view
        const otherViewDiff = await getFileDiff(rootFolderPath, filePath, !isStaged);

        if (otherViewDiff && otherViewDiff.lines.length > 0) {
          // Switch to the other view
          switchToView(isStaged ? "unstaged" : "staged");
          // Close current buffer after switching
          setTimeout(() => closeBuffer(activeBuffer.id), 100);
        } else {
          // No changes in either view, close the buffer
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

  // Listen for git status changes
  useEffect(() => {
    const handleGitStatusChanged = async () => {
      if (!rootFolderPath || !filePath || !activeBuffer) return;

      // Debounce rapid events
      if (isRefreshing.current) return;

      // Add a small delay to batch multiple rapid changes
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
