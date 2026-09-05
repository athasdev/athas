import { buildPersistedEditorViewState } from "@/features/editor/stores/editor-session-state";
import type { PaneContent } from "@/features/panes/types/pane-content.types";
import type { BufferSession } from "@/features/workspace/types/workspace-session.types";

interface EncodeWorkspaceBufferOptions {
  workspaceRootPath: string | undefined;
  workspaceFolderPaths?: string[];
  includeEditorId?: boolean;
}

interface BuildWorkspaceBufferSnapshotOptions extends EncodeWorkspaceBufferOptions {
  buffers: PaneContent[];
  activeBufferId: string | null;
  pendingBuffers?: BufferSession[];
}

interface WorkspaceBufferSnapshot {
  buffers: BufferSession[];
  activeBufferPath: string | null;
}

const normalizeWorkspacePath = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "");

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

export function encodeWorkspaceBuffer(
  buffer: PaneContent,
  {
    workspaceRootPath,
    workspaceFolderPaths = [],
    includeEditorId = false,
  }: EncodeWorkspaceBufferOptions,
): BufferSession | null {
  if (buffer.type === "editor" && !buffer.isVirtual) {
    return {
      type: "editor",
      ...(includeEditorId ? { id: buffer.id } : {}),
      name: buffer.name,
      path: buffer.path,
      isPinned: buffer.isPinned,
      isPreview: buffer.isPreview,
      workspaceScope: getEditorWorkspaceScope(buffer.path, workspaceRootPath, workspaceFolderPaths),
      editorState: buildPersistedEditorViewState(buffer),
    };
  }

  if (buffer.type === "terminal") {
    return {
      type: "terminal",
      path: buffer.path,
      name: buffer.name,
      isPinned: buffer.isPinned,
      sessionId: buffer.sessionId,
      shell: buffer.shell,
      initialCommand: buffer.initialCommand,
      workingDirectory: buffer.workingDirectory,
      remoteConnectionId: buffer.remoteConnectionId,
    };
  }

  return null;
}

export function buildWorkspaceBufferSnapshot({
  buffers,
  activeBufferId,
  pendingBuffers = [],
  ...encodeOptions
}: BuildWorkspaceBufferSnapshotOptions): WorkspaceBufferSnapshot {
  const openBuffers = buffers
    .map((buffer) => encodeWorkspaceBuffer(buffer, encodeOptions))
    .filter((buffer): buffer is BufferSession => buffer !== null);
  const openBufferPaths = new Set(openBuffers.map((buffer) => buffer.path));
  const persistedBuffers = [
    ...openBuffers,
    ...pendingBuffers.filter(
      (buffer) =>
        (buffer.type === "editor" || buffer.type === "terminal") &&
        !openBufferPaths.has(buffer.path),
    ),
  ];
  const activeBuffer = buffers.find((buffer) => buffer.id === activeBufferId);
  const activeBufferPath =
    activeBuffer && openBufferPaths.has(activeBuffer.path) ? activeBuffer.path : null;

  return {
    buffers: persistedBuffers,
    activeBufferPath,
  };
}
