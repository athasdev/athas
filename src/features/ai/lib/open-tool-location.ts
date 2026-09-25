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

/** Opens a file a tool call points at in the editor, at `line` (1-based) when it has one. */
export async function openToolPath(path: string, line?: number | null) {
  const resolvedPath = resolveWorkspacePath(path);
  const content = await readFileContent(resolvedPath);
  const bufferId = useBufferStore
    .getState()
    .actions.openBuffer(resolvedPath, getBaseName(resolvedPath), content);
  useBufferStore.getState().actions.setActiveBuffer(bufferId);
  if (!line) return;
  // The editor mounts for the new buffer first; it retries once more if its text is not in yet.
  setTimeout(() => {
    window.dispatchEvent(
      new CustomEvent("menu-go-to-line", { detail: { line, path: resolvedPath } }),
    );
  }, 100);
}
