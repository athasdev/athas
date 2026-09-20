import { useEffect, useMemo, useRef } from "react";
import { extensionRegistry } from "@/extensions/registry/extension-registry";
import { useExtensionStore } from "@/extensions/registry/extension-store";
import { deferUntilAfterNextPaint } from "@/features/editor/lsp/deferred-lsp-work";
import { LspClient } from "@/features/editor/lsp/lsp-client";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getSourceEditorBufferByPath } from "@/features/editor/utils/buffer-index";
import { logger } from "@/features/editor/utils/logger";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";

interface UseLspIntegrationOptions {
  enabled?: boolean;
  filePath: string | undefined;
  value: string;
}

export const useLspIntegration = ({
  enabled = true,
  filePath,
  value,
}: UseLspIntegrationOptions) => {
  const lspClient = useMemo(() => LspClient.getInstance(), []);
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
  const installedExtensions = useExtensionStore.use.installedExtensions();
  const activeFilePath = enabled ? filePath : undefined;
  const isLspSupported = useMemo(
    () => Boolean(activeFilePath && extensionRegistry.isLspSupported(activeFilePath)),
    [activeFilePath, installedExtensions],
  );
  const latestValueRef = useRef(value);

  useEffect(() => {
    latestValueRef.current = value;
  }, [value]);

  useEffect(() => {
    if (!enabled || !filePath || !isLspSupported) return;

    const workspacePath = rootFolderPath || filePath.substring(0, filePath.lastIndexOf("/"));
    if (!workspacePath) {
      console.warn("LSP: Could not determine workspace path for", filePath);
      return;
    }

    const cleanupDocument = () => {
      const isStillOpen = Boolean(
        getSourceEditorBufferByPath(useBufferStore.getState().buffers, filePath),
      );
      if (isStillOpen) return;

      if (lspClient.isDocumentOpen(filePath)) {
        lspClient.notifyDocumentClose(filePath).catch((error) => {
          console.error("LSP document close error:", error);
        });
        lspClient.stopForFile(filePath).catch((error) => {
          console.error("LSP stop for file error:", error);
        });
      }

    };

    if (lspClient.isDocumentOpen(filePath)) {
      return cleanupDocument;
    }

    let cancelled = false;

    const initializeLsp = async () => {
      try {
        logger.debug("LspIntegration", `Starting LSP for ${filePath} in ${workspacePath}`);
        const started = await lspClient.startForFile(filePath, workspacePath);
        if (!started || cancelled) return;

        await lspClient.notifyDocumentOpen(filePath, latestValueRef.current);
        logger.debug("LspIntegration", `LSP started and document opened for ${filePath}`);
      } catch (error) {
        console.error("LSP initialization error:", error);
      }
    };

    const cancelInitialization = deferUntilAfterNextPaint(() => {
      void initializeLsp();
    });

    return () => {
      cancelled = true;
      cancelInitialization();
      cleanupDocument();
    };
  }, [enabled, filePath, isLspSupported, lspClient, rootFolderPath]);
};
