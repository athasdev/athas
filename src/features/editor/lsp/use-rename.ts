import { useCallback, useEffect, useRef, useState } from "react";
import { editorAPI } from "@/features/editor/extensions/api";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useEditorStateStore } from "@/features/editor/stores/state-store";
import { readFileContent } from "@/features/file-system/controllers/file-operations";
import { hasTextContent } from "@/features/panes/types/pane-content";
import { LspClient } from "./lsp-client";
import { logger } from "../utils/logger";

interface RenameState {
  isVisible: boolean;
  symbol: string;
  line: number;
  column: number;
}

export const useRename = (filePath: string | undefined) => {
  const [renameState, setRenameState] = useState<RenameState | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const startRename = useCallback(() => {
    if (!filePath) return;

    const cursorPosition = useEditorStateStore.getState().cursorPosition;
    const lines = editorAPI.getLines();
    const currentLine = lines[cursorPosition.line] || "";

    // Extract word under cursor
    const before = currentLine.slice(0, cursorPosition.column + 1).match(/[\w$]+$/);
    const after = currentLine.slice(cursorPosition.column).match(/^[\w$]*/);
    const symbol = (before?.[0] || "") + (after?.[0]?.slice(1) || "");

    if (!symbol) return;

    setRenameState({
      isVisible: true,
      symbol,
      line: cursorPosition.line,
      column: cursorPosition.column,
    });

    // Focus input on next tick
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  }, [filePath]);

  const cancelRename = useCallback(() => {
    setRenameState(null);
  }, []);

  const executeRename = useCallback(
    async (newName: string) => {
      if (!filePath || !renameState) return;

      const trimmed = newName.trim();
      if (!trimmed || trimmed === renameState.symbol) {
        cancelRename();
        return;
      }

      setRenameState(null);

      try {
        const lspClient = LspClient.getInstance();
        const result = await lspClient.rename(
          filePath,
          renameState.line,
          renameState.column,
          trimmed,
        );

        if (!result?.changes) {
          logger.debug("Rename", "No changes returned from LSP");
          return;
        }

        // Apply workspace edit
        const bufferStore = useBufferStore.getState();

        for (const [fileUri, edits] of Object.entries(result.changes)) {
          const editFilePath = fileUri.replace("file://", "");

          // Get current content
          const buffer = bufferStore.buffers.find((b) => b.path === editFilePath);
          let content: string;
          if (buffer && hasTextContent(buffer)) {
            content = buffer.content;
          } else {
            content = await readFileContent(editFilePath);
          }

          // Apply edits in reverse order (bottom-to-top) to preserve positions
          const sortedEdits = [...edits].sort((a, b) => {
            const lineDiff = b.range.start.line - a.range.start.line;
            if (lineDiff !== 0) return lineDiff;
            return b.range.start.character - a.range.start.character;
          });

          const lines = content.split("\n");

          for (const edit of sortedEdits) {
            const startLine = edit.range.start.line;
            const startChar = edit.range.start.character;
            const endLine = edit.range.end.line;
            const endChar = edit.range.end.character;

            if (startLine === endLine) {
              // Single-line edit
              const line = lines[startLine] || "";
              lines[startLine] = line.slice(0, startChar) + edit.newText + line.slice(endChar);
            } else {
              // Multi-line edit
              const startContent = (lines[startLine] || "").slice(0, startChar);
              const endContent = (lines[endLine] || "").slice(endChar);
              const newLines = (startContent + edit.newText + endContent).split("\n");
              lines.splice(startLine, endLine - startLine + 1, ...newLines);
            }
          }

          const newContent = lines.join("\n");

          // Update buffer content
          if (buffer && hasTextContent(buffer)) {
            bufferStore.actions.updateBufferContent(buffer.id, newContent);
          }

          // If this is the active file, update the editor
          if (editFilePath === filePath) {
            editorAPI.setContent(newContent);
          }
        }

        logger.info(
          "Rename",
          `Renamed "${renameState.symbol}" to "${trimmed}" across ${Object.keys(result.changes).length} file(s)`,
        );
      } catch (error) {
        logger.error("Rename", "Failed to execute rename:", error);
      }
    },
    [filePath, renameState, cancelRename],
  );

  // Listen for rename event
  useEffect(() => {
    const handler = () => startRename();
    window.addEventListener("editor-rename-symbol", handler);
    return () => window.removeEventListener("editor-rename-symbol", handler);
  }, [startRename]);

  return {
    renameState,
    inputRef,
    cancelRename,
    executeRename,
  };
};
