import { invoke } from "@tauri-apps/api/core";
import { parseRemotePath } from "@/features/remote/utils/remote-path";
import type { WslDirectoryEntry } from "@/features/wsl/controllers/wsl-workspace";
import { parseWslPath } from "@/features/wsl/utils/wsl-path";
import { readDirectoryContents } from "../controllers/file-operations";
import { sortFileEntries } from "../controllers/file-tree-utils";
import type { RemoteDirectoryEntry } from "../controllers/remote-workspace";
import type { FileEntry } from "../types/app.types";

export interface WorkspaceResourceProvider {
  readonly kind: "local" | "remote" | "wsl";
  readDirectory(path: string, workspaceRoot: string): Promise<FileEntry[]>;
}

const localWorkspaceResourceProvider: WorkspaceResourceProvider = {
  kind: "local",
  async readDirectory(path, workspaceRoot) {
    return sortFileEntries(await readDirectoryContents(path, workspaceRoot));
  },
};

const remoteWorkspaceResourceProvider: WorkspaceResourceProvider = {
  kind: "remote",
  async readDirectory(path) {
    const remoteInfo = parseRemotePath(path);
    if (!remoteInfo) {
      throw new Error(`Invalid remote workspace path: ${path}`);
    }

    const entries = await invoke<RemoteDirectoryEntry[]>("ssh_read_directory", {
      connectionId: remoteInfo.connectionId,
      path: remoteInfo.remotePath,
    });

    return entries.map((entry) => ({
      name: entry.name,
      path: `remote://${remoteInfo.connectionId}${entry.path}`,
      isDir: entry.is_dir,
      children: entry.is_dir ? [] : undefined,
    }));
  },
};

const wslWorkspaceResourceProvider: WorkspaceResourceProvider = {
  kind: "wsl",
  async readDirectory(path) {
    const wslInfo = parseWslPath(path);
    if (!wslInfo) {
      throw new Error(`Invalid WSL workspace path: ${path}`);
    }

    const entries = await invoke<WslDirectoryEntry[]>("wsl_read_directory", {
      distro: wslInfo.distro,
      path: wslInfo.linuxPath,
    });

    return entries.map((entry) => ({
      name: entry.name,
      path: entry.path,
      isDir: entry.is_dir,
      children: entry.is_dir ? [] : undefined,
      isSymlink: entry.is_symlink,
      symlinkTarget: entry.target ?? undefined,
    }));
  },
};

export function getWorkspaceResourceProvider(path: string): WorkspaceResourceProvider {
  if (parseRemotePath(path)) {
    return remoteWorkspaceResourceProvider;
  }

  if (parseWslPath(path)) {
    return wslWorkspaceResourceProvider;
  }

  return localWorkspaceResourceProvider;
}

export function readWorkspaceDirectoryEntries(path: string, workspaceRoot = path) {
  return getWorkspaceResourceProvider(path).readDirectory(path, workspaceRoot);
}
