import type { BufferSession } from "@/features/window/stores/session-store";

export interface WorkspaceSessionBuffer {
  type: BufferSession["type"];
  path: string;
  name: string;
  isPinned: boolean;
  isPreview?: boolean;
  workspaceScope?: "workspace" | "external";
  editorState?: Extract<BufferSession, { type: "editor" }>["editorState"];
  url?: string;
  zoomLevel?: number;
  sessionId?: string;
  initialCommand?: string;
  workingDirectory?: string;
  remoteConnectionId?: string;
}

function normalizeWorkspacePath(path: string) {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function isLocalFileInWorkspace(filePath: string, workspaceRootPath: string | undefined) {
  if (!workspaceRootPath) {
    return false;
  }

  const normalizedFilePath = normalizeWorkspacePath(filePath);
  const normalizedWorkspaceRoot = normalizeWorkspacePath(workspaceRootPath);

  return (
    normalizedFilePath === normalizedWorkspaceRoot ||
    normalizedFilePath.startsWith(`${normalizedWorkspaceRoot}/`)
  );
}

export function getEditorWorkspaceScope(
  filePath: string,
  workspaceRootPath: string | undefined,
): "workspace" | "external" | undefined {
  if (
    filePath.startsWith("remote://") ||
    filePath.startsWith("diff://") ||
    filePath.startsWith("terminal://") ||
    filePath.startsWith("webview://")
  ) {
    return undefined;
  }

  return isLocalFileInWorkspace(filePath, workspaceRootPath) ? "workspace" : "external";
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

export interface WorkspaceRestoreBatch {
  buffersToRestore: WorkspaceSessionBuffer[];
  deferredBuffers: WorkspaceSessionBuffer[];
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

export const buildWorkspaceRestoreBatch = (
  candidateBuffers: WorkspaceSessionBuffer[],
  restoreLimit: number,
): WorkspaceRestoreBatch => {
  if (restoreLimit <= 0) {
    return {
      buffersToRestore: [],
      deferredBuffers: candidateBuffers,
    };
  }

  return {
    buffersToRestore: candidateBuffers.slice(0, restoreLimit),
    deferredBuffers: candidateBuffers.slice(restoreLimit),
  };
};
