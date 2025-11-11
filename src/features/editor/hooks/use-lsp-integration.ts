/**
 * Custom hook to handle all LSP integration logic
 * Consolidates LSP client setup, document lifecycle, completions, and hover
 */

import type { RefObject } from "react";
import { useEffect, useMemo, useRef } from "react";
import { LspClient } from "@/features/editor/lsp/lsp-client";
import { useLspStore } from "@/features/editor/lsp/lsp-store";
import { useHover } from "@/features/editor/lsp/use-hover";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useEditorUIStore } from "@/features/editor/stores/ui-store";
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
  const ext = filePath.split(".").pop()?.toLowerCase();
  return ext === "ts" || ext === "tsx" || ext === "js" || ext === "jsx";
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

  // Check if current file is supported
  const isLspSupported = useMemo(() => isFileSupported(filePath), [filePath]);

  // LSP store actions
  const lspActions = useLspStore.use.actions();

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
  useHover({
    getHover: lspClient.getHover.bind(lspClient),
    isLanguageSupported: (fp) => isFileSupported(fp),
    filePath: filePath || "",
    fontSize,
    lineNumbers,
  });

  // Handle document lifecycle (open/close)
  useEffect(() => {
    if (!filePath || !isLspSupported) return;

    // Notify LSP about document open
    lspClient.notifyDocumentOpen(filePath, value).catch((error) => {
      console.error("LSP document open error:", error);
    });

    return () => {
      // Notify LSP about document close
      lspClient.notifyDocumentClose(filePath).catch((error) => {
        console.error("LSP document close error:", error);
      });
    };
  }, [filePath, isLspSupported, lspClient]);

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
  };
};
