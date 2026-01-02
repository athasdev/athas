/**
 * Custom hook to handle all LSP integration logic
 * Consolidates LSP client setup, document lifecycle, completions, and hover
 */

import type { RefObject } from "react";
import { useEffect, useMemo, useRef } from "react";
import { extensionRegistry } from "@/extensions/registry/extension-registry";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { useEditorLayout } from "@/features/editor/hooks/use-layout";
import { useSnippetCompletion } from "@/features/editor/hooks/use-snippet-completion";
import { LspClient } from "@/features/editor/lsp/lsp-client";
import { useLspStore } from "@/features/editor/lsp/lsp-store";
import { useGoToDefinition } from "@/features/editor/lsp/use-go-to-definition";
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

  // Get layout dimensions for hover position calculations
  const { gutterWidth, charWidth } = useEditorLayout();

  // Use constant debounce for predictable completion behavior
  const completionTimerRef = useRef<NodeJS.Timeout | undefined>(undefined);

  // Track document versions per file path for LSP sync
  const documentVersionsRef = useRef<Map<string, number>>(new Map());

  // Track which documents have been opened (to avoid sending changes before open)
  const openedDocumentsRef = useRef<Set<string>>(new Set());

  // Get completion application state
  const isApplyingCompletion = useEditorUIStore.use.isApplyingCompletion();

  // Track when user actually types (not just cursor movement)
  const lastInputTimestamp = useEditorUIStore.use.lastInputTimestamp();

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
    gutterWidth,
    charWidth,
  });

  // Set up go-to-definition (Cmd+Click)
  const goToDefinitionHandlers = useGoToDefinition({
    getDefinition: lspClient.getDefinition.bind(lspClient),
    isLanguageSupported: (fp) => isFileSupported(fp),
    filePath: filePath || "",
    fontSize,
    lineNumbers,
    gutterWidth,
    charWidth,
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
        // Reset document version for this file
        // Rust sends version 1 on document open, so we start at 1
        // First change will increment to 2
        documentVersionsRef.current.set(filePath, 1);
        // Start LSP server for this file type
        await lspClient.startForFile(filePath, workspacePath);
        // Notify LSP about document open
        await lspClient.notifyDocumentOpen(filePath, value);
        // Mark document as opened so changes can be sent
        openedDocumentsRef.current.add(filePath);
        console.log("LSP: LSP started and document opened for", filePath);
      } catch (error) {
        console.error("LSP initialization error:", error);
      }
    };

    initLsp();

    return () => {
      // Notify LSP about document close and clean up tracking
      lspClient.notifyDocumentClose(filePath).catch((error) => {
        console.error("LSP document close error:", error);
      });
      documentVersionsRef.current.delete(filePath);
      openedDocumentsRef.current.delete(filePath);
    };
  }, [filePath, isLspSupported, lspClient, rootFolderPath]);

  // Handle document content changes
  useEffect(() => {
    if (!filePath || !isLspSupported) return;

    // Only send changes after document is opened to avoid race condition
    if (!openedDocumentsRef.current.has(filePath)) {
      return;
    }

    // Increment document version for this file
    const currentVersion = documentVersionsRef.current.get(filePath) || 1;
    const newVersion = currentVersion + 1;
    documentVersionsRef.current.set(filePath, newVersion);

    lspClient.notifyDocumentChange(filePath, value, newVersion).catch((error) => {
      console.error("LSP document change error:", error);
    });
  }, [value, filePath, isLspSupported, lspClient]);

  // Handle completion triggers - only when user types (not on cursor movement)
  useEffect(() => {
    // Safety: reset stuck isApplyingCompletion flag
    // This can happen if a previous completion application didn't complete properly
    if (isApplyingCompletion && lastInputTimestamp > 0) {
      useEditorUIStore.getState().actions.setIsApplyingCompletion(false);
    }

    // Only trigger completions when user actually types
    if (!filePath || !editorRef.current || !isLspSupported || lastInputTimestamp === 0) {
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
    }, EDITOR_CONSTANTS.COMPLETION_DEBOUNCE_MS);

    return () => {
      if (completionTimerRef.current) {
        clearTimeout(completionTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cursorPosition and isApplyingCompletion are read at render time, not as triggers
  }, [lastInputTimestamp, filePath, lspActions, isLspSupported, editorRef]);

  return {
    lspClient,
    isLspSupported,
    snippetCompletion,
    hoverHandlers,
    goToDefinitionHandlers,
  };
};
