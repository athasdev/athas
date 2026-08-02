import { useEffect } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getExplorerTargetPath } from "@/features/file-explorer/utils/file-explorer-tree-utils";

interface UseFileExplorerSyncOptions {
  activePath?: string;
  autoRevealActiveFile: boolean;
  updateActivePath?: (path: string) => void;
  revealPathInTree: (path: string) => Promise<void>;
}

export function useFileExplorerSync({
  activePath,
  autoRevealActiveFile,
  updateActivePath,
  revealPathInTree,
}: UseFileExplorerSyncOptions) {
  const explorerTargetPath = useBufferStore((state) => {
    const activeBuffer = state.activeBufferId
      ? state.buffers.find((buffer) => buffer.id === state.activeBufferId)
      : null;

    return getExplorerTargetPath(activeBuffer ?? null);
  });

  useEffect(() => {
    if (!explorerTargetPath) {
      if (activePath) {
        updateActivePath?.("");
      }
      return;
    }

    if (explorerTargetPath === activePath) return;
    updateActivePath?.(explorerTargetPath);
  }, [activePath, explorerTargetPath, updateActivePath]);

  useEffect(() => {
    if (!autoRevealActiveFile || !explorerTargetPath) return;
    void revealPathInTree(explorerTargetPath);
  }, [autoRevealActiveFile, explorerTargetPath, revealPathInTree]);
}
