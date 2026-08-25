import { invoke } from "@tauri-apps/api/core";
import { readFile as readLocalFileBytes } from "@tauri-apps/plugin-fs";
import { parseRemotePath } from "@/features/remote/utils/remote-path";
import type { WslDirectoryEntry } from "@/features/wsl/controllers/wsl-workspace";
import { parseWslPath } from "@/features/wsl/utils/wsl-path";
import { readDirectoryContents, readFileContent } from "../controllers/file-operations";
import { sortFileEntries } from "../controllers/file-tree-utils";
import type { RemoteDirectoryEntry } from "../controllers/remote-workspace";
import type { FileEntry } from "../types/app.types";

export interface WorkspaceResourceProvider {
  readonly kind: "local" | "remote" | "wsl";
  readDirectory(path: string, workspaceRoot: string): Promise<FileEntry[]>;
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array | null>;
}

const localWorkspaceResourceProvider: WorkspaceResourceProvider = {
  kind: "local",
  async readDirectory(path, workspaceRoot) {
    return sortFileEntries(await readDirectoryContents(path, workspaceRoot));
  },
  readText: readFileContent,
  readBytes: readLocalFileBytes,
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
  async readText(path) {
    const remoteInfo = parseRemotePath(path);
    if (!remoteInfo) {
      throw new Error(`Invalid remote workspace path: ${path}`);
    }

    return await invoke<string>("ssh_read_file", {
      connectionId: remoteInfo.connectionId,
      filePath: remoteInfo.remotePath,
    });
  },
  async readBytes() {
    return null;
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
  async readText(path) {
    const wslInfo = parseWslPath(path);
    if (!wslInfo) {
      throw new Error(`Invalid WSL workspace path: ${path}`);
    }

    return await invoke<string>("wsl_read_file", {
      distro: wslInfo.distro,
      filePath: wslInfo.linuxPath,
    });
  },
  async readBytes(path) {
    const wslInfo = parseWslPath(path);
    if (!wslInfo) {
      throw new Error(`Invalid WSL workspace path: ${path}`);
    }

    const bytes = await invoke<number[]>("wsl_read_file_bytes", {
      distro: wslInfo.distro,
      filePath: wslInfo.linuxPath,
    });
    return Uint8Array.from(bytes);
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
