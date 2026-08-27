import { workspaceSessionRepository } from "@/features/workspace/persistence/workspace-session-repository";
import { buildWorkspaceBufferSnapshot } from "@/features/workspace/persistence/workspace-session-codec";
import { createWorkspaceSessionSaveQueue } from "@/features/workspace/persistence/workspace-session-save-queue";
import type { PaneContent } from "@/features/panes/types/pane-content.types";

const SAVE_SESSION_DEBOUNCE_MS = 300;

const saveSessionToStoreImmediate = (
  projectPath: string,
  buffers: PaneContent[],
  activeBufferId: string | null,
) => {
  const snapshot = buildWorkspaceBufferSnapshot({
    buffers,
    activeBufferId,
    workspaceRootPath: projectPath,
  });

  workspaceSessionRepository.save({
    projectPath,
    ...snapshot,
  });
};

const sessionSaveQueue = createWorkspaceSessionSaveQueue(
  (projectPath: string, payload: { buffers: PaneContent[]; activeBufferId: string | null }) => {
    saveSessionToStoreImmediate(projectPath, payload.buffers, payload.activeBufferId);
  },
  SAVE_SESSION_DEBOUNCE_MS,
);

export const saveSessionToStore = (
  projectPath: string | undefined,
  buffers: PaneContent[],
  activeBufferId: string | null,
) => {
  if (!projectPath) return;

  sessionSaveQueue.schedule(projectPath, {
    buffers,
    activeBufferId,
  });
};

export const clearQueuedWorkspaceSessionSave = (projectPath: string) => {
  sessionSaveQueue.clear(projectPath);
};
