import { buildRemoteRootPath } from "@/features/remote/utils/remote-path";
import type { FileEntry } from "../types/app";

export interface RemoteDirectoryEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
}

export interface RemoteWorkspaceTree {
  remotePath: string;
  fileTree: FileEntry[];
  wrappedFileTree: FileEntry[];
}

export function buildRemoteWorkspaceTree(
  connectionId: string,
  connectionName: string,
  entries: RemoteDirectoryEntry[],
): RemoteWorkspaceTree {
  const remotePath = buildRemoteRootPath(connectionId);
  const fileTree: FileEntry[] = entries.map((entry) => ({
    name: entry.name,
    path: `remote://${connectionId}${entry.path}`,
    isDir: entry.is_dir,
    children: entry.is_dir ? [] : undefined,
  }));

  return {
    remotePath,
    fileTree,
    wrappedFileTree: [
      {
        name: connectionName,
        path: remotePath,
        isDir: true,
        children: fileTree,
      },
    ],
  };
}
