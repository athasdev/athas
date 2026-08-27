import { getSymlinkInfo } from "@/features/file-system/controllers/platform";
import type { FileEntry } from "@/features/file-system/types/app.types";
import { resolveWslTargetPath } from "@/features/wsl/utils/wsl-path";

type ReadSymlinkInfo = typeof getSymlinkInfo;

export const shouldResolveFileOpenSymlink = (path: string, entry: FileEntry | null | undefined) =>
  entry?.isSymlink === true && !path.startsWith("diff://") && !path.startsWith("remote://");

export async function resolveFileOpenPath(
  path: string,
  entry: FileEntry | null | undefined,
  workspaceRoot: string | undefined,
  readSymlinkInfo: ReadSymlinkInfo = getSymlinkInfo,
): Promise<string> {
  if (!entry || !shouldResolveFileOpenSymlink(path, entry)) {
    return path;
  }

  const symlinkInfo = entry.symlinkTarget
    ? { is_symlink: true, target: entry.symlinkTarget }
    : await readSymlinkInfo(path, workspaceRoot);

  if (!symlinkInfo.is_symlink || !symlinkInfo.target) {
    return path;
  }

  const wslTargetPath = resolveWslTargetPath(path, symlinkInfo.target);
  if (wslTargetPath) {
    return wslTargetPath;
  }

  const pathSeparator = path.includes("\\") ? "\\" : "/";
  const pathParts = path.split(pathSeparator);
  pathParts.pop();
  const parentDir = pathParts.join(pathSeparator);

  if (symlinkInfo.target.startsWith(pathSeparator) || symlinkInfo.target.match(/^[a-zA-Z]:/)) {
    return symlinkInfo.target;
  }

  return workspaceRoot
    ? `${workspaceRoot}${pathSeparator}${symlinkInfo.target}`
    : `${parentDir}${pathSeparator}${symlinkInfo.target}`;
}
