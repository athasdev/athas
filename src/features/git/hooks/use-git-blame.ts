import { useCallback, useEffect } from "react";
import { subscribeToEditorDocumentChanges } from "@/features/editor/services/editor-document-events";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getBufferById } from "@/features/editor/stores/buffer-index";
import { useWorkspaceStoreScopeId } from "@/features/workspace/stores/create-workspace-scoped-store";
import {
  type GitChange,
  type GitChangeScope,
  isGitChangeRelevant,
  subscribeToGitChanges,
} from "../events/git-events";
import { getGitBlameCacheKey, useGitBlameStore } from "../stores/git-blame.store";
import type { GitBlameLine } from "../types/git.types";
import { findGitBlameLine } from "../utils/git-blame-lines";
import { readBufferText } from "@/features/editor/services/buffer-text";
import { useProjectStore } from "@/features/workspace/stores/project.store";

const BLAME_REFRESH_DELAY_MS = 500;

/** Scopes that can move HEAD. Saves, staging, and ref-only changes keep the committed blame. */
const BLAME_SCOPES: ReadonlySet<GitChangeScope> = new Set(["history", "repository"]);

export function canGitChangeAffectBlame(change: GitChange): boolean {
  return !change.scopes || change.scopes.some((scope) => BLAME_SCOPES.has(scope));
}

/** Reads from the editor's own workspace, which need not be the active one. */
function readEditorContent(workspaceId: string | null, bufferId: string): string | null {
  const store = workspaceId ? useBufferStore.getStore(workspaceId) : useBufferStore;
  const buffer = getBufferById(store.getState().buffers, bufferId);
  return buffer?.type === "editor" ? readBufferText(buffer) : null;
}

/**
 * Blame for the buffer's current text. Edits re-arm a debounced reload through the document
 * change events, so typing never re-renders the caller; the text is read only when it fires.
 */
export function useGitBlame(filePath: string | undefined, bufferId: string) {
  const workspaceId = useWorkspaceStoreScopeId();
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  const loadBlameForFile = useGitBlameStore((state) => state.actions.loadBlameForFile);
  const invalidateBlameForFile = useGitBlameStore((state) => state.actions.invalidateBlameForFile);
  const blameRevision = useGitBlameStore((state) => state.revision);
  const cacheKey =
    filePath && rootFolderPath ? getGitBlameCacheKey(rootFolderPath, filePath) : null;
  const blameData = useGitBlameStore((state) =>
    cacheKey ? state.blameData.get(cacheKey) : undefined,
  );
  const blamedContent = useGitBlameStore((state) =>
    cacheKey ? state.blameContent.get(cacheKey) : undefined,
  );

  useEffect(() => {
    if (!filePath || !rootFolderPath) return;

    let timeoutId: number | null = null;
    const scheduleLoad = () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        timeoutId = null;
        const content = readEditorContent(workspaceId, bufferId);
        if (content === null) return;
        void loadBlameForFile(rootFolderPath, filePath, content);
      }, BLAME_REFRESH_DELAY_MS);
    };

    scheduleLoad();
    const unsubscribeDocument = subscribeToEditorDocumentChanges((event) => {
      if (event.bufferId === bufferId) scheduleLoad();
    });
    const unsubscribeGit = subscribeToGitChanges((change) => {
      if (!canGitChangeAffectBlame(change)) return;
      if (!isGitChangeRelevant(change, rootFolderPath, filePath)) return;
      // Recorded in the store at once, so the reload survives this effect being torn down.
      invalidateBlameForFile(rootFolderPath, filePath);
      scheduleLoad();
    });

    return () => {
      unsubscribeDocument();
      unsubscribeGit();
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [
    blameRevision,
    bufferId,
    filePath,
    invalidateBlameForFile,
    loadBlameForFile,
    rootFolderPath,
    workspaceId,
  ]);

  const getBlameForLine = useCallback(
    (lineNumber: number): GitBlameLine | null => {
      if (!filePath || !blameData) return null;
      // Blame for older text would name the wrong lines until the reload lands.
      if (blamedContent !== readEditorContent(workspaceId, bufferId)) return null;
      return findGitBlameLine(blameData.lines, lineNumber + 1);
    },
    [blameData, blamedContent, bufferId, filePath, workspaceId],
  );

  return { getBlameForLine };
}
