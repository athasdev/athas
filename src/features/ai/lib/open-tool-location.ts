import { homeDir } from "@tauri-apps/api/path";
import { toast } from "sonner";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { readFileContent } from "@/features/file-system/controllers/file-operations";
import { useProjectStore } from "@/features/window/stores/project.store";
import { getBaseName, joinPath } from "@/utils/path-helpers";

const HOME_RELATIVE_PATH_RE = /^~(?:[\\/]|$)/;

let homeDirectory: Promise<string | null> | null = null;

function getHomeDirectory(): Promise<string | null> {
  homeDirectory ??= homeDir().catch(() => null);
  return homeDirectory;
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("remote://");
}

/**
 * Resolves a tool call path against the open workspace when the agent sent it relative.
 * Agents also send `~/...` paths; those resolve against `home` and are never joined to
 * the workspace root, which produced paths like `<root>/~/...` that do not exist.
 */
export function resolveWorkspacePath(path: string, home?: string | null): string {
  if (HOME_RELATIVE_PATH_RE.test(path)) {
    return home ? joinPath(home, path.slice(1)) : path;
  }
  if (isAbsolutePath(path)) return path;
  const rootFolderPath = useProjectStore.getState().rootFolderPath;
  return rootFolderPath ? joinPath(rootFolderPath, path) : path;
}

/** Like `resolveWorkspacePath`, but looks up the home directory for `~/...` paths. */
export async function resolveToolPath(path: string): Promise<string> {
  const home = HOME_RELATIVE_PATH_RE.test(path) ? await getHomeDirectory() : null;
  return resolveWorkspacePath(path, home);
}

export function showToolPathError(path: string, error: unknown) {
  toast.error(`Could not open ${getBaseName(path) || path}`, {
    description: error instanceof Error ? error.message : String(error),
  });
}

/** Opens a file a tool call points at in the editor, at `line` (1-based) when it has one. */
export async function openToolPath(path: string, line?: number | null) {
  const resolvedPath = await resolveToolPath(path);
  let content: string;
  try {
    content = await readFileContent(resolvedPath);
  } catch (error) {
    showToolPathError(resolvedPath, error);
    return;
  }
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
