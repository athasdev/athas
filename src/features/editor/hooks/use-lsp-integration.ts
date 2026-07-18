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

const DOCUMENT_CHANGE_DEBOUNCE_MS = 75;

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
  const documentChangeTimerRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const documentVersionsRef = useRef<Map<string, number>>(new Map());
  const latestValueRef = useRef(value);
  const openedDocumentsRef = useRef<Set<string>>(new Set());

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

      if (openedDocumentsRef.current.has(filePath)) {
        lspClient.notifyDocumentClose(filePath).catch((error) => {
          console.error("LSP document close error:", error);
        });
        lspClient.stopForFile(filePath).catch((error) => {
          console.error("LSP stop for file error:", error);
        });
      }

      documentVersionsRef.current.delete(filePath);
      openedDocumentsRef.current.delete(filePath);
    };

    if (openedDocumentsRef.current.has(filePath)) {
      return cleanupDocument;
    }

    const initializeLsp = async () => {
      try {
        logger.debug("LspIntegration", `Starting LSP for ${filePath} in ${workspacePath}`);
        documentVersionsRef.current.set(filePath, 1);
        const started = await lspClient.startForFile(filePath, workspacePath);
        if (!started) return;

        await lspClient.notifyDocumentOpen(filePath, latestValueRef.current);
        openedDocumentsRef.current.add(filePath);
        logger.debug("LspIntegration", `LSP started and document opened for ${filePath}`);
      } catch (error) {
        console.error("LSP initialization error:", error);
      }
    };

    const cancelInitialization = deferUntilAfterNextPaint(() => {
      void initializeLsp();
    });

    return () => {
      cancelInitialization();
      cleanupDocument();
    };
  }, [enabled, filePath, isLspSupported, lspClient, rootFolderPath]);

  useEffect(() => {
    if (!enabled || !filePath || !isLspSupported) return;
    if (!openedDocumentsRef.current.has(filePath)) return;

    if (documentChangeTimerRef.current) {
      clearTimeout(documentChangeTimerRef.current);
    }

    documentChangeTimerRef.current = setTimeout(() => {
      if (!openedDocumentsRef.current.has(filePath)) return;

      const currentVersion = documentVersionsRef.current.get(filePath) || 1;
      const newVersion = currentVersion + 1;
      documentVersionsRef.current.set(filePath, newVersion);

      lspClient.notifyDocumentChange(filePath, value, newVersion).catch((error) => {
        console.error("LSP document change error:", error);
      });
    }, DOCUMENT_CHANGE_DEBOUNCE_MS);

    return () => {
      if (documentChangeTimerRef.current) {
        clearTimeout(documentChangeTimerRef.current);
        documentChangeTimerRef.current = undefined;
      }
    };
  }, [enabled, filePath, isLspSupported, lspClient, value]);
};
