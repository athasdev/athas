export interface WorkspaceSessionBuffer {
  path: string;
  name: string;
  isPinned: boolean;
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

export const buildWorkspaceRestorePlan = (
  session: WorkspaceSessionSnapshot | null | undefined,
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
