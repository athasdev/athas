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
import { prewarmGitBlame } from "../api/git-blame-api";
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

/** Most files warmed after one HEAD change; the backend applies the same cap. */
const BLAME_PREWARM_FILE_LIMIT = 5;

/** Reads from the editor's own workspace, which need not be the active one. */
function getWorkspaceBufferStore(workspaceId: string | null) {
  return workspaceId ? useBufferStore.getStore(workspaceId) : useBufferStore;
}

function readEditorContent(workspaceId: string | null, bufferId: string): string | null {
  const buffer = getBufferById(getWorkspaceBufferStore(workspaceId).getState().buffers, bufferId);
  return buffer?.type === "editor" ? readBufferText(buffer) : null;
}

const pendingPrewarms = new Map<string, Set<string>>();

/**
 * Collects the files every shown editor reports for one git change, then warms them first and
 * the workspace's other open files after them. Their blame request comes after the reload delay,
 * by which time the backend has usually finished walking history.
 */
function scheduleBlamePrewarm(
  workspaceId: string | null,
  rootFolderPath: string,
  filePath: string,
): void {
  const key = `${workspaceId ?? ""}\0${rootFolderPath}`;
  const pending = pendingPrewarms.get(key);
  if (pending) {
    pending.add(filePath);
    return;
  }
  const shownFiles = new Set([filePath]);
  pendingPrewarms.set(key, shownFiles);
  queueMicrotask(() => {
    pendingPrewarms.delete(key);
    const files = new Set(shownFiles);
    for (const buffer of getWorkspaceBufferStore(workspaceId).getState().buffers) {
      if (files.size >= BLAME_PREWARM_FILE_LIMIT) break;
      if (buffer.type === "editor" && !buffer.isVirtual && buffer.path) files.add(buffer.path);
    }
    void prewarmGitBlame(rootFolderPath, [...files].slice(0, BLAME_PREWARM_FILE_LIMIT));
  });
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
      scheduleBlamePrewarm(workspaceId, rootFolderPath, filePath);
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
