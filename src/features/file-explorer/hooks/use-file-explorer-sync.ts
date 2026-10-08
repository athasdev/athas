import { useCallback, useEffect, useRef, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getExplorerTargetPath } from "@/features/file-explorer/services/file-explorer-tree-utils";
import { useActiveBufferId } from "@/features/panes/hooks/use-pane-buffer-state";
import { runAfterNextPaint } from "@/utils/after-paint";

interface UseFileExplorerSyncOptions {
  activePath?: string;
  autoRevealActiveFile: boolean;
  updateActivePath?: (path: string) => void;
  revealPathInTree: (path: string) => Promise<void>;
}

interface FileExplorerRevealRequest {
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
  const activeBufferId = useActiveBufferId();
  const explorerTargetPath = useBufferStore((state) => {
    const activeBuffer = activeBufferId
      ? state.buffers.find((buffer) => buffer.id === activeBufferId)
      : null;

    return getExplorerTargetPath(activeBuffer ?? null);
  });

  // A newly opened file is highlighted and revealed after the editor showing it has painted, so
  // re-rendering the tree does not hold up the file.
  const syncedTargetPathRef = useRef(explorerTargetPath);
  useEffect(() => {
    const syncActivePath = () => {
      if (!explorerTargetPath) {
        if (activePath) {
          updateActivePath?.("");
        }
        return;
      }

      if (explorerTargetPath === activePath) return;
      updateActivePath?.(explorerTargetPath);
    };
    if (syncedTargetPathRef.current === explorerTargetPath) {
      syncActivePath();
      return;
    }
    syncedTargetPathRef.current = explorerTargetPath;
    return runAfterNextPaint(syncActivePath);
  }, [activePath, explorerTargetPath, updateActivePath]);

  useEffect(() => {
    const requestId = ++revealRequestIdRef.current;
    if (!autoRevealActiveFile || !explorerTargetPath) {
      setRevealRequest(null);
      return;
    }

    setRevealRequest(null);
    let active = true;
    const cancelReveal = runAfterNextPaint(() => {
      void revealPathInTree(explorerTargetPath)
        .then(() => {
          if (!active || requestId !== revealRequestIdRef.current) return;
          setRevealRequest({ id: requestId, path: explorerTargetPath });
        })
        .catch(() => {});
    });

    return () => {
      active = false;
      cancelReveal();
    };
  }, [autoRevealActiveFile, explorerTargetPath, revealPathInTree]);

  const consumeRevealRequest = useCallback((requestId: number) => {
    setRevealRequest((current) => (current?.id === requestId ? null : current));
  }, []);

  return { consumeRevealRequest, revealRequest };
}
