import type { BufferSession } from "@/features/window/stores/session-store";

export interface WorkspaceSessionBuffer {
  type: BufferSession["type"];
  path: string;
  name: string;
  isPinned: boolean;
  url?: string;
  zoomLevel?: number;
  sessionId?: string;
  initialCommand?: string;
  workingDirectory?: string;
  remoteConnectionId?: string;
}

export interface WorkspaceSessionSnapshot {
  activeBufferPath: string | null;
  buffers: WorkspaceSessionBuffer[];
}

export interface WorkspaceRestorePlan {
  activeBufferPath: string | null;
  initialBuffer: WorkspaceSessionBuffer | null;
  remainingBuffers: WorkspaceSessionBuffer[];
}

type WorkspaceRestoreSession = Pick<WorkspaceSessionSnapshot, "activeBufferPath"> & {
  buffers: BufferSession[];
};

export const buildWorkspaceRestorePlan = (
  session: WorkspaceRestoreSession | null | undefined,
): WorkspaceRestorePlan => {
  if (!session || session.buffers.length === 0) {
    return {
      activeBufferPath: null,
      initialBuffer: null,
      remainingBuffers: [],
    };
  }

  const initialBuffer =
    (session.activeBufferPath
      ? session.buffers.find((buffer) => buffer.path === session.activeBufferPath)
      : null) ?? session.buffers[0];

  return {
    activeBufferPath: session.activeBufferPath,
    initialBuffer,
    remainingBuffers: session.buffers.filter((buffer) => buffer.path !== initialBuffer.path),
  };
};
