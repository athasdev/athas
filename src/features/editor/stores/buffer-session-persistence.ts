import { workspaceSessionRepository } from "@/features/workspace/persistence/workspace-session-repository";
import { buildWorkspaceBufferSnapshot } from "@/features/workspace/persistence/workspace-session-codec";
import { createWorkspaceSessionSaveQueue } from "@/features/workspace/persistence/workspace-session-save-queue";
import type { PaneContent } from "@/features/panes/types/pane-content.types";

const SAVE_SESSION_DEBOUNCE_MS = 300;

export interface BufferSessionPayload {
  buffers: PaneContent[];
  activeBufferId: string | null;
  pinnedBufferIds?: ReadonlySet<string>;
  previewBufferIds?: ReadonlySet<string>;
}

const saveSessionToStoreImmediate = (projectPath: string, payload: BufferSessionPayload) => {
  const snapshot = buildWorkspaceBufferSnapshot({
    ...payload,
    workspaceRootPath: projectPath,
  });

  workspaceSessionRepository.save({
    projectPath,
    ...snapshot,
  });
};

const sessionSaveQueue = createWorkspaceSessionSaveQueue(
  saveSessionToStoreImmediate,
  SAVE_SESSION_DEBOUNCE_MS,
);

export const saveSessionToStore = (
  projectPath: string | undefined,
  payload: BufferSessionPayload,
) => {
  if (!projectPath) return;

  sessionSaveQueue.schedule(projectPath, payload);
};

export const clearQueuedWorkspaceSessionSave = (projectPath: string) => {
  sessionSaveQueue.clear(projectPath);
};
