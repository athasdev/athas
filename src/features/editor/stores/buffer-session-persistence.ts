import { useProjectStore } from "@/features/window/stores/project-store";
import type { BufferSession } from "@/features/window/stores/session-store";
import { useSessionStore } from "@/features/window/stores/session-store";
import { createWorkspaceSessionSaveQueue } from "./workspace-session-save-queue";
import type { PaneContent } from "@/features/panes/types/pane-content";

const SAVE_SESSION_DEBOUNCE_MS = 300;

const serializeBufferForSession = (buffer: PaneContent): BufferSession | null => {
  if (buffer.type === "editor" && !buffer.isVirtual) {
    return {
      type: "editor",
      path: buffer.path,
      name: buffer.name,
      isPinned: buffer.isPinned,
    };
  }

  if (buffer.type === "terminal") {
    return {
      type: "terminal",
      path: buffer.path,
      name: buffer.name,
      isPinned: buffer.isPinned,
      sessionId: buffer.sessionId,
      initialCommand: buffer.initialCommand,
      workingDirectory: buffer.workingDirectory,
      remoteConnectionId: buffer.remoteConnectionId,
    };
  }

  if (buffer.type === "webViewer") {
    return {
      type: "webViewer",
      path: buffer.path,
      name: buffer.name,
      isPinned: buffer.isPinned,
      url: buffer.url,
      zoomLevel: buffer.zoomLevel,
    };
  }

  return null;
};

const saveSessionToStoreImmediate = (
  projectPath: string,
  buffers: PaneContent[],
  activeBufferId: string | null,
) => {
  const persistableBuffers = buffers
    .map(serializeBufferForSession)
    .filter((buffer): buffer is BufferSession => buffer !== null);

  const activeBuffer = buffers.find((buffer) => buffer.id === activeBufferId);
  const activeBufferPath =
    activeBuffer &&
    ((activeBuffer.type === "editor" && !activeBuffer.isVirtual) ||
      activeBuffer.type === "terminal" ||
      activeBuffer.type === "webViewer")
      ? activeBuffer.path
      : null;

  useSessionStore.getState().saveSession(projectPath, persistableBuffers, activeBufferPath);
};

const sessionSaveQueue = createWorkspaceSessionSaveQueue(
  (projectPath: string, payload: { buffers: PaneContent[]; activeBufferId: string | null }) => {
    saveSessionToStoreImmediate(projectPath, payload.buffers, payload.activeBufferId);
  },
  SAVE_SESSION_DEBOUNCE_MS,
);

export const saveSessionToStore = (buffers: PaneContent[], activeBufferId: string | null) => {
  const rootFolderPath = useProjectStore.getState().rootFolderPath;

  if (!rootFolderPath) return;

  sessionSaveQueue.schedule(rootFolderPath, {
    buffers,
    activeBufferId,
  });
};

export const clearQueuedWorkspaceSessionSave = (projectPath: string) => {
  sessionSaveQueue.clear(projectPath);
};
