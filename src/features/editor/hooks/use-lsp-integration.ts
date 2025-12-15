/**
 * Custom hook to handle all LSP integration logic
 * Consolidates LSP client setup, document lifecycle, completions, and hover
 */

import type { RefObject } from "react";
import { useEffect, useMemo, useRef } from "react";
import { extensionRegistry } from "@/extensions/registry/extension-registry";
import { useSnippetCompletion } from "@/features/editor/hooks/use-snippet-completion";
import { LspClient } from "@/features/editor/lsp/lsp-client";
import { useLspStore } from "@/features/editor/lsp/lsp-store";
import { useHover } from "@/features/editor/lsp/use-hover";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useEditorUIStore } from "@/features/editor/stores/ui-store";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import type { Position } from "../types/editor";

interface UseLspIntegrationOptions {
  filePath: string | undefined;
  value: string;
  cursorPosition: Position;
  editorRef: RefObject<HTMLDivElement | null> | RefObject<HTMLTextAreaElement>;
  fontSize: number;
  lineNumbers: boolean;
}

/**
 * Check if file extension is supported by LSP
 */
const isFileSupported = (filePath: string | undefined): boolean => {
  if (!filePath) return false;
  // Use extension registry to check if LSP is supported for this file
  return extensionRegistry.isLspSupported(filePath);
};

/**
 * Hook that manages all LSP integration for the editor
 */
export const useLspIntegration = ({
  filePath,
  value,
  cursorPosition,
  editorRef,
  fontSize,
  lineNumbers,
}: UseLspIntegrationOptions) => {
  // Get LSP client instance (singleton)
  const lspClient = useMemo(() => LspClient.getInstance(), []);

  // Get workspace path
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);

  // Check if current file is supported
  const isLspSupported = useMemo(() => isFileSupported(filePath), [filePath]);

  // LSP store actions
  const lspActions = useLspStore.use.actions();

  // Snippet completion integration
  const snippetCompletion = useSnippetCompletion(filePath);

  // Use fixed debounce for predictable completion behavior
  const completionTimerRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const COMPLETION_DEBOUNCE = 400; // Fixed 400ms debounce

  // Get completion application state
  const isApplyingCompletion = useEditorUIStore.use.isApplyingCompletion();

  // Set up LSP completion handlers
  useEffect(() => {
    lspActions.setCompletionHandlers(lspClient.getCompletions.bind(lspClient), (fp: string) =>
      isFileSupported(fp),
    );
  }, [lspClient, lspActions]);

  // Set up hover functionality
  const hoverHandlers = useHover({
    getHover: lspClient.getHover.bind(lspClient),
    isLanguageSupported: (fp) => isFileSupported(fp),
    filePath: filePath || "",
    fontSize,
    lineNumbers,
  });

  // Handle document lifecycle (open/close)
  useEffect(() => {
    if (!filePath || !isLspSupported) return;

    // Derive workspace path from file path if rootFolderPath is not set
    // This handles cases where files are opened without a project folder
    const workspacePath = rootFolderPath || filePath.substring(0, filePath.lastIndexOf("/"));

    if (!workspacePath) {
      console.warn("LSP: Could not determine workspace path for", filePath);
      return;
    }

    // Start LSP server for this file and then notify about document open
    const initLsp = async () => {
      try {
        console.log("LSP: Starting LSP for file", filePath, "in workspace", workspacePath);
        // Start LSP server for this file type
        await lspClient.startForFile(filePath, workspacePath);
        // Notify LSP about document open
        await lspClient.notifyDocumentOpen(filePath, value);
        console.log("LSP: LSP started and document opened for", filePath);
      } catch (error) {
        console.error("LSP initialization error:", error);
      }
    };

    initLsp();

    return () => {
      // Notify LSP about document close
      lspClient.notifyDocumentClose(filePath).catch((error) => {
        console.error("LSP document close error:", error);
      });
    };
  }, [filePath, isLspSupported, lspClient, rootFolderPath]);

  // Handle document content changes
  useEffect(() => {
    if (!filePath || !isLspSupported) return;

    lspClient.notifyDocumentChange(filePath, value, 1).catch((error) => {
      console.error("LSP document change error:", error);
    });
  }, [value, filePath, isLspSupported, lspClient]);

  // Handle completion triggers - only on cursor position change (not content)
  useEffect(() => {
    if (!filePath || !editorRef.current || isApplyingCompletion || !isLspSupported) {
      if (completionTimerRef.current) {
        clearTimeout(completionTimerRef.current);
      }
      return;
    }

    // Debounce completion trigger with fixed delay for predictable behavior
    completionTimerRef.current = setTimeout(() => {
      // Get latest value at trigger time (not from effect deps)
      const buffer = useBufferStore.getState().buffers.find((b) => b.path === filePath);
      if (!buffer) return;

      lspActions.requestCompletion({
        filePath,
        cursorPos: cursorPosition.offset,
        value: buffer.content, // Use latest content from store
        editorRef: editorRef as RefObject<HTMLDivElement | null>,
      });
    }, COMPLETION_DEBOUNCE);

    return () => {
      if (completionTimerRef.current) {
        clearTimeout(completionTimerRef.current);
      }
    };
  }, [
    cursorPosition, // Only trigger on cursor change, not content
    filePath,
    lspActions,
    isApplyingCompletion,
    isLspSupported,
    editorRef,
  ]);

  return {
    lspClient,
    isLspSupported,
    snippetCompletion,
    hoverHandlers,
  };
};
