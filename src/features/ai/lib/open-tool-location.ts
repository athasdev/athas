import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { readFileContent } from "@/features/file-system/controllers/file-operations";
import { useProjectStore } from "@/features/window/stores/project.store";
import { getBaseName, joinPath } from "@/utils/path-helpers";

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("remote://");
}

/** Resolves a tool call path against the open workspace when the agent sent it relative. */
export function resolveWorkspacePath(path: string): string {
  if (isAbsolutePath(path)) return path;
  const rootFolderPath = useProjectStore.getState().rootFolderPath;
  return rootFolderPath ? joinPath(rootFolderPath, path) : path;
}

/** Opens a file a tool call points at in the editor. */
export async function openToolPath(path: string) {
  const resolvedPath = resolveWorkspacePath(path);
  const content = await readFileContent(resolvedPath);
  const bufferId = useBufferStore
    .getState()
    .actions.openBuffer(resolvedPath, getBaseName(resolvedPath), content);
  useBufferStore.getState().actions.setActiveBuffer(bufferId);
}
