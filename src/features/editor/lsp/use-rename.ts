import { useCallback, useEffect, useRef, useState } from "react";
import { readBufferRevision, readBufferText } from "@/features/editor/services/buffer-text";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useEditorStateStore } from "@/features/editor/stores/state.store";
import { getLineTextFromContent } from "@/features/editor/utils/position";
import { useActiveWorkspaceId } from "@/features/workspace/stores/create-workspace-scoped-store";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";
import { showToast } from "@/features/layout/contexts/toast-context";
import { LspClient } from "./lsp-client";
import {
  applyWorkspaceEdit,
  isWorkspaceEdit,
  isWorkspaceEditContextLive,
  offsetFromPosition,
  normalizeWorkspaceEditPath,
  type WorkspaceEditContext,
} from "./workspace-edit";
import { logger } from "../utils/logger";

interface RenameState {
  isVisible: boolean;
  symbol: string;
  line: number;
  column: number;
  context: WorkspaceEditContext;
  controller: AbortController;
}
function getWordUnderCursor(line: string, column: number): string {
  const before = line.slice(0, column).match(/[\p{ID_Continue}$]+$/u);
  const after = line.slice(column).match(/^[\p{ID_Continue}$]*/u);
  return (before?.[0] || "") + (after?.[0] || "");
}
function getTextForRange(
  content: string,
  range: { start: { line: number; character: number }; end: { line: number; character: number } },
): string {
  return content.slice(
    offsetFromPosition(content, range.start),
    offsetFromPosition(content, range.end),
  );
}
export const useRename = (filePath: string | undefined) => {
  const workspaceId = useActiveWorkspaceId();
  const activeBufferId = useBufferStore.use.activeBufferId();
  const [renameState, setRenameState] = useState<RenameState | null>(null);
  const stateRef = useRef(renameState);
  stateRef.current = renameState;
  const inputRef = useRef<HTMLInputElement>(null);
  const pending = useRef<AbortController | null>(null);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelRename = useCallback(() => {
    pending.current?.abort();
    pending.current = null;
    if (focusTimer.current) clearTimeout(focusTimer.current);
    focusTimer.current = null;
    stateRef.current = null;
    setRenameState(null);
  }, []);
  useEffect(() => {
    cancelRename();
    return () => {
      pending.current?.abort();
      if (focusTimer.current) clearTimeout(focusTimer.current);
    };
  }, [filePath, workspaceId, activeBufferId, cancelRename]);

  const startRename = useCallback(async () => {
    if (!filePath) return;
    const lspClient = LspClient.getInstance();
    const context = lspClient.createWorkspaceEditContext(workspaceId);
    const source = context.sources.get(normalizeWorkspaceEditPath(filePath));
    if (
      !source ||
      source.readOnly ||
      source.isVirtual ||
      context.store.getState().activeBufferId !== source.id
    )
      return;
    cancelRename();
    const controller = new AbortController();
    pending.current = controller;
    let expectedSource = source;
    context.onBufferApplied = (buffer) => {
      if (buffer.id === source.id) expectedSource = buffer;
    };
    context.isCurrent = () => {
      const current = context.store.getState().buffers.find((buffer) => buffer.id === source.id);
      return (
        !controller.signal.aborted &&
        pending.current === controller &&
        workspaceRuntimeRegistry.getActiveWorkspaceId() === workspaceId &&
        context.store.getState().activeBufferId === source.id &&
        current?.type === "editor" &&
        current.path === filePath &&
        !current.readOnly &&
        readBufferRevision(current) === (expectedSource.contentRevision ?? 0) &&
        readBufferText(current) === expectedSource.content
      );
    };
    const cursorPosition = useEditorStateStore.getState().cursorPosition;
    const currentLine = getLineTextFromContent(source.content, cursorPosition.line);
    try {
      const prepared = await lspClient.prepareRename(
        filePath,
        cursorPosition.line,
        cursorPosition.column,
      );
      if (!isWorkspaceEditContextLive(context)) return;
      const range =
        prepared?.range ??
        (prepared?.start && prepared?.end ? { start: prepared.start, end: prepared.end } : null);
      const symbol =
        prepared?.placeholder ||
        (range ? getTextForRange(source.content, range) : "") ||
        getWordUnderCursor(currentLine, cursorPosition.column);
      if (!symbol) return;
      const state = {
        isVisible: true,
        symbol,
        line: cursorPosition.line,
        column: cursorPosition.column,
        context,
        controller,
      };
      stateRef.current = state;
      setRenameState(state);
      focusTimer.current = setTimeout(() => {
        if (!isWorkspaceEditContextLive(context)) return;
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
    } catch (error) {
      if (isWorkspaceEditContextLive(context))
        showToast({ message: `Could not prepare rename: ${String(error)}`, type: "error" });
    }
  }, [filePath, workspaceId, cancelRename]);

  const executeRename = useCallback(
    async (newName: string) => {
      const state = stateRef.current;
      if (!state) return;
      if (!filePath || !isWorkspaceEditContextLive(state.context)) {
        cancelRename();
        return;
      }
      const trimmed = newName.trim();
      if (!trimmed || trimmed === state.symbol) {
        cancelRename();
        return;
      }
      stateRef.current = null;
      setRenameState(null);
      try {
        const result = await LspClient.getInstance().rename(
          filePath,
          state.line,
          state.column,
          trimmed,
        );
        if (!isWorkspaceEditContextLive(state.context)) return;
        if (!isWorkspaceEdit(result))
          throw new Error("Language server did not return a supported rename edit");
        const { editedFiles } = await applyWorkspaceEdit(result, state.context);
        logger.info(
          "Rename",
          `Renamed "${state.symbol}" to "${trimmed}" across ${editedFiles} file(s)`,
        );
      } catch (error) {
        logger.error("Rename", "Failed to execute rename:", error);
        if (!state.controller.signal.aborted)
          showToast({ message: `Could not rename: ${String(error)}`, type: "error" });
      } finally {
        if (pending.current === state.controller) pending.current = null;
      }
    },
    [filePath, cancelRename],
  );
  useEffect(() => {
    const handler = () => void startRename();
    window.addEventListener("editor-rename-symbol", handler);
    return () => window.removeEventListener("editor-rename-symbol", handler);
  }, [startRename]);
  return { renameState, inputRef, cancelRename, executeRename };
};
