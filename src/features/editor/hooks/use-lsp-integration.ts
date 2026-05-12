/**
 * Custom hook to handle all LSP integration logic
 * Consolidates LSP client setup, document lifecycle, completions, and hover
 */

import type { RefObject } from "react";
import { useEffect, useMemo, useRef } from "react";
import { extensionRegistry } from "@/extensions/registry/extension-registry";
import { useExtensionStore } from "@/extensions/registry/extension-store";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { useEditorLayout } from "@/features/editor/hooks/use-layout";
import { useSnippetCompletion } from "@/features/editor/hooks/use-snippet-completion";
import { LspClient } from "@/features/editor/lsp/lsp-client";
import { useLspStore } from "@/features/editor/lsp/lsp-store";
import { useDefinitionLink } from "@/features/editor/lsp/use-definition-link";
import { useGoToDefinition } from "@/features/editor/lsp/use-go-to-definition";
import { useHover } from "@/features/editor/lsp/use-hover";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useEditorStateStore } from "@/features/editor/stores/state-store";
import { useEditorUIStore } from "@/features/editor/stores/ui-store";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { hasTextContent } from "@/features/panes/types/pane-content";
import { logger } from "../utils/logger";
import type { EditorCoordinateResolver } from "../view-model/view-layout";

interface UseLspIntegrationOptions {
  enabled?: boolean;
  filePath: string | undefined;
  value: string;
  editorRef: RefObject<HTMLDivElement | null> | RefObject<HTMLTextAreaElement>;
  resolveEditorPosition?: EditorCoordinateResolver;
}

/**
 * Check if file extension is supported by LSP
 */
const isFileSupported = (filePath: string | undefined): boolean => {
  if (!filePath) return false;
  // Use extension registry to check if LSP is supported for this file
  return extensionRegistry.isLspSupported(filePath);
};

const DOCUMENT_CHANGE_DEBOUNCE_MS = 75;

/**
 * Hook that manages all LSP integration for the editor
 */
export const useLspIntegration = ({
  enabled = true,
  filePath,
  value,
  editorRef,
  resolveEditorPosition,
}: UseLspIntegrationOptions) => {
  // Get LSP client instance (singleton)
  const lspClient = useMemo(() => LspClient.getInstance(), []);

  // Get workspace path
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
  const installedExtensions = useExtensionStore.use.installedExtensions();

  // Check if current file is supported
  const activeFilePath = enabled ? filePath : undefined;
  const isLspSupported = useMemo(
    () => enabled && isFileSupported(activeFilePath),
    [enabled, activeFilePath, installedExtensions],
  );

  // LSP store actions
  const lspActions = useLspStore.use.actions();

  // Snippet completion integration
  const snippetCompletion = useSnippetCompletion(activeFilePath);

  // Get layout dimensions for hover position calculations
  const { charWidth, lineHeight } = useEditorLayout();

  // Use constant debounce for predictable completion behavior
  const completionTimerRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const documentChangeTimerRef = useRef<NodeJS.Timeout | undefined>(undefined);

  // Track cursor position where completions were triggered (to hide on cursor movement)
  const completionTriggerOffsetRef = useRef<number | null>(null);

  // Track the latest input timestamp already considered for completions.
  const lastHandledCompletionInputRef = useRef(0);

  // Track document versions per file path for LSP sync
  const documentVersionsRef = useRef<Map<string, number>>(new Map());
  const latestValueRef = useRef(value);
  const cursorPositionRef = useRef(useEditorStateStore.getState().cursorPosition);
  const lastInputTimestampRef = useRef(useEditorUIStore.getState().lastInputTimestamp);

  // Track which documents have been opened (to avoid sending changes before open)
  const openedDocumentsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    latestValueRef.current = value;
  }, [value]);

  useEffect(() => {
    let previousOffset = useEditorStateStore.getState().cursorPosition.offset;
    cursorPositionRef.current = useEditorStateStore.getState().cursorPosition;

    const unsubscribe = useEditorStateStore.subscribe((state) => {
      const nextPosition = state.cursorPosition;
      cursorPositionRef.current = nextPosition;
      if (!enabled || nextPosition.offset === previousOffset) {
        previousOffset = nextPosition.offset;
        return;
      }

      previousOffset = nextPosition.offset;
      const { isLspCompletionVisible } = useEditorUIStore.getState();

      if (!isLspCompletionVisible) {
        prevInputTimestampRef.current = lastInputTimestampRef.current;
        return;
      }

      if (lastInputTimestampRef.current !== prevInputTimestampRef.current) {
        prevInputTimestampRef.current = lastInputTimestampRef.current;
        return;
      }

      useEditorUIStore.getState().actions.setIsLspCompletionVisible(false);
      completionTriggerOffsetRef.current = null;
    });

    return unsubscribe;
  }, [enabled]);

  // Set up LSP completion handlers
  useEffect(() => {
    if (!enabled) return;
    lspActions.setCompletionHandlers(lspClient.getCompletions.bind(lspClient), (fp: string) =>
      isFileSupported(fp),
    );
  }, [enabled, lspClient, lspActions]);

  // Set up hover functionality
  const hoverHandlers = useHover({
    getHover: lspClient.getHover.bind(lspClient),
    isLanguageSupported: (fp) => isFileSupported(fp),
    filePath: activeFilePath || "",
    lineHeight,
    charWidth,
    resolveEditorPosition,
  });

  // Set up go-to-definition (Cmd+Click)
  const goToDefinitionHandlers = useGoToDefinition({
    getDefinition: lspClient.getDefinition.bind(lspClient),
    isLanguageSupported: (fp) => isFileSupported(fp),
    filePath: activeFilePath || "",
    lineHeight,
    charWidth,
    resolveEditorPosition,
  });

  // Set up definition link highlighting (Cmd+hover)
  const definitionLinkHandlers = useDefinitionLink({
    filePath: activeFilePath || "",
    content: enabled ? value : "",
    lineHeight,
    charWidth,
    isLanguageSupported: enabled && isLspSupported,
    getDefinition: lspClient.getDefinition.bind(lspClient),
    resolveEditorPosition,
  });

  // Handle document lifecycle (open/close)
  useEffect(() => {
    if (!enabled) return;
    if (!filePath || !isLspSupported) return;

    // Derive workspace path from file path if rootFolderPath is not set
    // This handles cases where files are opened without a project folder
    const workspacePath = rootFolderPath || filePath.substring(0, filePath.lastIndexOf("/"));

    if (!workspacePath) {
      console.warn("LSP: Could not determine workspace path for", filePath);
      return;
    }

    const cleanupDocument = () => {
      const isStillOpen = useBufferStore
        .getState()
        .buffers.some((buffer) => hasTextContent(buffer) && buffer.path === filePath);

      if (isStillOpen) {
        return;
      }

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

    // Start LSP server for this file and then notify about document open
    const initLsp = async () => {
      try {
        logger.debug("LspIntegration", `Starting LSP for ${filePath} in ${workspacePath}`);
        // Reset document version for this file
        // Rust sends version 1 on document open, so we start at 1
        // First change will increment to 2
        documentVersionsRef.current.set(filePath, 1);
        // Start LSP server for this file type
        const started = await lspClient.startForFile(filePath, workspacePath);
        if (!started) {
          return;
        }
        // Notify LSP about document open
        await lspClient.notifyDocumentOpen(filePath, latestValueRef.current);
        // Mark document as opened so changes can be sent
        openedDocumentsRef.current.add(filePath);
        logger.debug("LspIntegration", `LSP started and document opened for ${filePath}`);
      } catch (error) {
        console.error("LSP initialization error:", error);
      }
    };

    initLsp();

    return cleanupDocument;
  }, [enabled, filePath, isLspSupported, lspClient, rootFolderPath]);

  // Handle document content changes
  useEffect(() => {
    if (!enabled) return;
    if (!filePath || !isLspSupported) return;

    // Only send changes after document is opened to avoid race condition
    if (!openedDocumentsRef.current.has(filePath)) {
      return;
    }

    if (documentChangeTimerRef.current) {
      clearTimeout(documentChangeTimerRef.current);
    }

    documentChangeTimerRef.current = setTimeout(() => {
      if (!openedDocumentsRef.current.has(filePath)) {
        return;
      }

      // Increment document version only for the flushed content. Full-sync LSP servers do not
      // need every intermediate keystroke, but they do need monotonically increasing versions.
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
  }, [enabled, value, filePath, isLspSupported, lspClient]);

  useEffect(() => {
    lastHandledCompletionInputRef.current = useEditorUIStore.getState().lastInputTimestamp;
    completionTriggerOffsetRef.current = null;

    if (completionTimerRef.current) {
      clearTimeout(completionTimerRef.current);
      completionTimerRef.current = undefined;
    }
    if (documentChangeTimerRef.current) {
      clearTimeout(documentChangeTimerRef.current);
      documentChangeTimerRef.current = undefined;
    }
  }, [filePath]);

  // Handle completion triggers - only when user types (not on cursor movement)
  useEffect(() => {
    if (!enabled) return;

    const unsubscribe = useEditorUIStore.subscribe((state) => {
      const lastInputTimestamp = state.lastInputTimestamp;
      lastInputTimestampRef.current = lastInputTimestamp;

      // Safety: reset stuck isApplyingCompletion flag
      // This can happen if a previous completion application didn't complete properly.
      if (state.isApplyingCompletion && lastInputTimestamp > 0) {
        useEditorUIStore.getState().actions.setIsApplyingCompletion(false);
      }

      // Only trigger completions when user actually types.
      if (
        !filePath ||
        !editorRef.current ||
        !isLspSupported ||
        lastInputTimestamp === 0 ||
        !openedDocumentsRef.current.has(filePath)
      ) {
        if (completionTimerRef.current) {
          clearTimeout(completionTimerRef.current);
          completionTimerRef.current = undefined;
        }
        return;
      }

      // Skip file switches and repeated renders that did not originate from a new edit in this file.
      if (lastInputTimestamp <= lastHandledCompletionInputRef.current) {
        return;
      }

      lastHandledCompletionInputRef.current = lastInputTimestamp;

      if (completionTimerRef.current) {
        clearTimeout(completionTimerRef.current);
      }

      // Debounce completion trigger with fixed delay for predictable behavior
      completionTimerRef.current = setTimeout(() => {
        // Get latest value at trigger time (not from effect deps)
        const buffer = useBufferStore.getState().buffers.find((b) => b.path === filePath);
        if (!buffer || !hasTextContent(buffer)) return;

        const cursorOffset = cursorPositionRef.current.offset;

        // Store the cursor offset where completion was triggered
        completionTriggerOffsetRef.current = cursorOffset;

        lspActions.requestCompletion({
          filePath,
          cursorPos: cursorOffset,
          value: buffer.content, // Use latest content from store
          editorRef: editorRef as RefObject<HTMLDivElement | null>,
        });
      }, EDITOR_CONSTANTS.COMPLETION_DEBOUNCE_MS);
    });

    return () => {
      unsubscribe();
      if (completionTimerRef.current) {
        clearTimeout(completionTimerRef.current);
        completionTimerRef.current = undefined;
      }
    };
  }, [enabled, filePath, lspActions, isLspSupported, editorRef]);

  useEffect(() => {
    if (!enabled) return;

    const handleTriggerSuggest = () => {
      if (
        !filePath ||
        !editorRef.current ||
        !isLspSupported ||
        !openedDocumentsRef.current.has(filePath)
      ) {
        return;
      }

      const buffer = useBufferStore.getState().buffers.find((b) => b.path === filePath);
      if (!buffer || !hasTextContent(buffer)) return;

      const cursorOffset = cursorPositionRef.current.offset;
      completionTriggerOffsetRef.current = cursorOffset;

      void lspActions.requestCompletion({
        filePath,
        cursorPos: cursorOffset,
        value: buffer.content,
        editorRef: editorRef as RefObject<HTMLDivElement | null>,
        manual: true,
      });
    };

    window.addEventListener("editor-trigger-suggest", handleTriggerSuggest);
    return () => window.removeEventListener("editor-trigger-suggest", handleTriggerSuggest);
  }, [enabled, filePath, lspActions, isLspSupported, editorRef]);

  const prevInputTimestampRef = useRef<number>(0);

  return {
    lspClient,
    isLspSupported,
    snippetCompletion,
    hoverHandlers,
    goToDefinitionHandlers,
    definitionLinkHandlers,
  };
};
