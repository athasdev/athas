import { useCallback, useEffect, useRef, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getExplorerTargetPath } from "@/features/file-explorer/utils/file-explorer-tree-utils";

interface UseFileExplorerSyncOptions {
  activePath?: string;
  autoRevealActiveFile: boolean;
  updateActivePath?: (path: string) => void;
  revealPathInTree: (path: string) => Promise<void>;
}

export interface FileExplorerRevealRequest {
  id: number;
  path: string;
}

export function useFileExplorerSync({
  activePath,
  autoRevealActiveFile,
  updateActivePath,
  revealPathInTree,
}: UseFileExplorerSyncOptions) {
  const revealRequestIdRef = useRef(0);
  const [revealRequest, setRevealRequest] = useState<FileExplorerRevealRequest | null>(null);
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
    const requestId = ++revealRequestIdRef.current;
    if (!autoRevealActiveFile || !explorerTargetPath) {
      setRevealRequest(null);
      return;
    }

    setRevealRequest(null);
    let active = true;
    void revealPathInTree(explorerTargetPath)
      .then(() => {
        if (!active || requestId !== revealRequestIdRef.current) return;
        setRevealRequest({ id: requestId, path: explorerTargetPath });
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [autoRevealActiveFile, explorerTargetPath, revealPathInTree]);

  const consumeRevealRequest = useCallback((requestId: number) => {
    setRevealRequest((current) => (current?.id === requestId ? null : current));
  }, []);

  return { consumeRevealRequest, revealRequest };
}
