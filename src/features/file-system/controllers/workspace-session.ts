import type { BufferSession } from "@/features/workspace/types/workspace-session.types";

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
  profileKey?: string;
  history?: string[];
  historyIndex?: number;
  sessionId?: string;
  shell?: string;
  initialCommand?: string;
  workingDirectory?: string;
  remoteConnectionId?: string;
}

export interface WorkspaceFolderSession {
  path: string;
  name: string;
  isPrimary?: boolean;
}

function normalizeWorkspacePath(path: string) {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function normalizeWorkspaceFolders(
  rootFolderPath: string | undefined,
  workspaceFolders: WorkspaceFolderSession[] | undefined,
): WorkspaceFolderSession[] {
  const normalizedFolders = new Map<string, WorkspaceFolderSession>();

  if (rootFolderPath) {
    normalizedFolders.set(normalizeWorkspacePath(rootFolderPath), {
      path: rootFolderPath,
      name: rootFolderPath.split(/[\\/]/).filter(Boolean).pop() || rootFolderPath,
      isPrimary: true,
    });
  }

  for (const folder of workspaceFolders ?? []) {
    const key = normalizeWorkspacePath(folder.path);
    normalizedFolders.set(key, {
      ...folder,
      isPrimary: folder.isPrimary || folder.path === rootFolderPath,
    });
  }

  return Array.from(normalizedFolders.values()).map((folder, index) => ({
    ...folder,
    isPrimary: index === 0 ? true : folder.isPrimary,
  }));
}

export function selectRestoredWorkspaceFolders(
  rootFolderPath: string,
  workspaceFolders: WorkspaceFolderSession[],
  restoredFolderPaths: readonly string[],
): WorkspaceFolderSession[] {
  const restoredPaths = new Set(
    [rootFolderPath, ...restoredFolderPaths].map(normalizeWorkspacePath),
  );

  return normalizeWorkspaceFolders(rootFolderPath, workspaceFolders).filter((folder) =>
    restoredPaths.has(normalizeWorkspacePath(folder.path)),
  );
}

export function isWorkspaceFolderPath(
  path: string,
  rootFolderPath: string | undefined,
  workspaceFolders: WorkspaceFolderSession[],
) {
  return normalizeWorkspaceFolders(rootFolderPath, workspaceFolders).some(
    (folder) => normalizeWorkspacePath(folder.path) === normalizeWorkspacePath(path),
  );
}

interface WorkspaceSessionSnapshot {
  activeBufferPath: string | null;
  buffers: WorkspaceSessionBuffer[];
}

export interface WorkspaceRestorePlan {
  activeBufferPath: string | null;
  initialBuffer: BufferSession | null;
  remainingBuffers: BufferSession[];
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

  if (session.activeBufferPath) {
    let initialBuffer: BufferSession | null = null;
    const remainingBuffers: BufferSession[] = [];

    for (const buffer of session.buffers) {
      if (buffer.path === session.activeBufferPath) {
        initialBuffer ??= buffer;
      } else {
        remainingBuffers.push(buffer);
      }
    }

    if (initialBuffer) {
      return {
        activeBufferPath: session.activeBufferPath,
        initialBuffer,
        remainingBuffers,
      };
    }
  }

  const initialBuffer = session.buffers[0];
  const remainingBuffers = session.buffers.filter((buffer) => buffer.path !== initialBuffer.path);

  return {
    activeBufferPath: session.activeBufferPath,
    initialBuffer,
    remainingBuffers,
  };
};

export const buildWorkspaceRestoreBatch = <T extends WorkspaceSessionBuffer>(
  candidateBuffers: T[],
  restoreLimit: number,
): { buffersToRestore: T[]; deferredBuffers: T[] } => {
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
