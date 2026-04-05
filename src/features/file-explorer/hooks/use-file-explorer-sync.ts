import { useEffect, useMemo } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { getExplorerTargetPath } from "@/features/file-explorer/utils/file-explorer-tree-utils";

interface UseFileExplorerSyncOptions {
  activePath?: string;
  updateActivePath?: (path: string) => void;
  revealPathInTree: (path: string) => Promise<void>;
}

export function useFileExplorerSync({
  activePath,
  updateActivePath,
  revealPathInTree,
}: UseFileExplorerSyncOptions) {
  const buffers = useBufferStore.use.buffers();
  const activeBufferId = useBufferStore.use.activeBufferId();

  const activeBuffer = useMemo(
    () => buffers.find((buffer) => buffer.id === activeBufferId) || null,
    [buffers, activeBufferId],
  );

  const explorerTargetPath = useMemo(() => getExplorerTargetPath(activeBuffer), [activeBuffer]);

  useEffect(() => {
    if (!explorerTargetPath || explorerTargetPath === activePath) return;
    updateActivePath?.(explorerTargetPath);
  }, [activePath, explorerTargetPath, updateActivePath]);

  useEffect(() => {
    if (!explorerTargetPath) return;
    void revealPathInTree(explorerTargetPath);
  }, [explorerTargetPath, revealPathInTree]);
}
