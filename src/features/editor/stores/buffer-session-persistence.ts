import { workspaceSessionRepository } from "@/features/workspace/persistence/workspace-session-repository";
import { encodeWorkspaceBuffer } from "@/features/workspace/persistence/workspace-session-codec";
import type { BufferSession } from "@/features/workspace/types/workspace-session.types";
import { createWorkspaceSessionSaveQueue } from "./workspace-session-save-queue";
import type { PaneContent } from "@/features/panes/types/pane-content.types";
import { getBufferById } from "../utils/buffer-index";

const SAVE_SESSION_DEBOUNCE_MS = 300;

const saveSessionToStoreImmediate = (
  projectPath: string,
  buffers: PaneContent[],
  activeBufferId: string | null,
) => {
  const persistableBuffers = buffers
    .map((buffer) => encodeWorkspaceBuffer(buffer, { workspaceRootPath: projectPath }))
    .filter((buffer): buffer is BufferSession => buffer !== null);

  const activeBuffer = getBufferById(buffers, activeBufferId);
  const activeBufferPath =
    activeBuffer &&
    ((activeBuffer.type === "editor" && !activeBuffer.isVirtual) ||
      activeBuffer.type === "terminal" ||
      activeBuffer.type === "webViewer")
      ? activeBuffer.path
      : null;

  workspaceSessionRepository.save({
    projectPath,
    buffers: persistableBuffers,
    activeBufferPath,
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
