import { useCallback, useEffect, useRef, useState } from "react";
import { editorAPI } from "@/features/editor/extensions/api";
import { useEditorStateStore } from "@/features/editor/stores/state-store";
import { LspClient } from "./lsp-client";
import { applyWorkspaceEdit, isWorkspaceEdit, offsetFromPosition } from "./workspace-edit";
import { logger } from "../utils/logger";

interface RenameState {
  isVisible: boolean;
  symbol: string;
  line: number;
  column: number;
}

function getWordUnderCursor(line: string, column: number): string {
  const before = line.slice(0, column + 1).match(/[\w$]+$/);
  const after = line.slice(column).match(/^[\w$]*/);
  return (before?.[0] || "") + (after?.[0]?.slice(1) || "");
}

function getTextForRange(
  content: string,
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  },
): string {
  const start = offsetFromPosition(content, range.start);
  const end = offsetFromPosition(content, range.end);
  return content.slice(start, end);
}

export const useRename = (filePath: string | undefined) => {
  const [renameState, setRenameState] = useState<RenameState | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const startRename = useCallback(async () => {
    if (!filePath) return;

    const cursorPosition = useEditorStateStore.getState().cursorPosition;
    const lines = editorAPI.getLines();
    const currentLine = lines[cursorPosition.line] || "";
    const content = editorAPI.getContent();
    const lspClient = LspClient.getInstance();
    const prepared = await lspClient.prepareRename(
      filePath,
      cursorPosition.line,
      cursorPosition.column,
    );
    const preparedRange = prepared?.range
      ? prepared.range
      : prepared?.start && prepared?.end
        ? { start: prepared.start, end: prepared.end }
        : null;
    const symbol =
      prepared?.placeholder ||
      (preparedRange ? getTextForRange(content, preparedRange) : "") ||
      getWordUnderCursor(currentLine, cursorPosition.column);

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

        if (!isWorkspaceEdit(result)) {
          logger.debug("Rename", "No changes returned from LSP");
          return;
        }

        const { editedFiles } = await applyWorkspaceEdit(result);

        logger.info(
          "Rename",
          `Renamed "${renameState.symbol}" to "${trimmed}" across ${editedFiles} file(s)`,
        );
      } catch (error) {
        logger.error("Rename", "Failed to execute rename:", error);
      }
    },
    [filePath, renameState, cancelRename],
  );

  // Listen for rename event
  useEffect(() => {
    const handler = () => void startRename();
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
