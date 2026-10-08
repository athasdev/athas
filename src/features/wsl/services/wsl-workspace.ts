import type { FileEntry } from "@/features/file-system/types/app.types";
import { buildWslPath } from "../utils/wsl-path";

export interface WslDistribution {
  name: string;
  state?: string | null;
  version?: number | null;
  is_default: boolean;
}

export interface WslDirectoryEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  is_symlink: boolean;
  target?: string | null;
}

export interface WslWorkspaceTree {
  wslPath: string;
  fileTree: FileEntry[];
  wrappedFileTree: FileEntry[];
}

export function getWslProjectName(distro: string, linuxPath: string): string {
  const segments = linuxPath.split("/").filter(Boolean);
  const folderName = segments[segments.length - 1];
  return folderName ? `${folderName} (${distro})` : distro;
}

export function buildWslWorkspaceTree(
  distro: string,
  linuxPath: string,
  entries: WslDirectoryEntry[],
): WslWorkspaceTree {
  const wslPath = buildWslPath(distro, linuxPath);
  const fileTree: FileEntry[] = entries.map((entry) => ({
    name: entry.name,
    path: entry.path,
    isDir: entry.is_dir,
    children: entry.is_dir ? [] : undefined,
    isSymlink: entry.is_symlink,
    symlinkTarget: entry.target ?? undefined,
  }));
  const projectName = getWslProjectName(distro, linuxPath);

  return {
    wslPath,
    fileTree,
    wrappedFileTree: [
      {
        name: projectName,
        path: wslPath,
        isDir: true,
        children: fileTree,
      },
    ],
  };
}
