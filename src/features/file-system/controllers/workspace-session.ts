import type { BufferSession } from "@/features/window/stores/session.store";

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

export function isLocalFileInWorkspace(
  filePath: string,
  workspaceRootPath: string | undefined,
  workspaceFolderPaths: string[] = [],
) {
  const workspaceRoots = [
    workspaceRootPath,
    ...workspaceFolderPaths.filter((folderPath) => folderPath !== workspaceRootPath),
  ].filter((folderPath): folderPath is string => !!folderPath);

  if (workspaceRoots.length === 0) {
    return false;
  }

  const normalizedFilePath = normalizeWorkspacePath(filePath);

  return workspaceRoots.some((workspaceRoot) => {
    const normalizedWorkspaceRoot = normalizeWorkspacePath(workspaceRoot);
    return (
      normalizedFilePath === normalizedWorkspaceRoot ||
      normalizedFilePath.startsWith(`${normalizedWorkspaceRoot}/`)
    );
  });
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

export function isWorkspaceFolderPath(
  path: string,
  rootFolderPath: string | undefined,
  workspaceFolders: WorkspaceFolderSession[],
) {
  return normalizeWorkspaceFolders(rootFolderPath, workspaceFolders).some(
    (folder) => normalizeWorkspacePath(folder.path) === normalizeWorkspacePath(path),
  );
}

export function getEditorWorkspaceScope(
  filePath: string,
  workspaceRootPath: string | undefined,
  workspaceFolderPaths: string[] = [],
): "workspace" | "external" | undefined {
  if (
    filePath.startsWith("remote://") ||
    filePath.startsWith("wsl://") ||
    filePath.startsWith("diff://") ||
    filePath.startsWith("terminal://") ||
    filePath.startsWith("webview://")
  ) {
    return undefined;
  }

  return isLocalFileInWorkspace(filePath, workspaceRootPath, workspaceFolderPaths)
    ? "workspace"
    : "external";
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
