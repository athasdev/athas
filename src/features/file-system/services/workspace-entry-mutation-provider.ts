import { invoke } from "@tauri-apps/api/core";
import { dirname, join } from "@tauri-apps/api/path";
import { parseRemotePath } from "@/features/remote/utils/remote-path";
import { buildWslPath, parseWslPath } from "@/features/wsl/utils/wsl-path";
import { joinPath } from "@/utils/path-helpers";
import {
  createNewDirectory,
  createNewFile,
  deleteFileOrDirectory,
} from "../controllers/file-operations";
import { renameFile } from "../controllers/platform";

export interface WorkspaceEntryMutationProvider {
  readonly kind: "local" | "remote" | "wsl";
  createFile(directoryPath: string, fileName: string): Promise<string>;
  createDirectory(parentPath: string, folderName: string): Promise<string>;
  deletePath(path: string, isDirectory: boolean): Promise<void>;
  renamePath(path: string, newName: string): Promise<string>;
}

const createPlatformMutationProvider = (kind: "local" | "wsl"): WorkspaceEntryMutationProvider => ({
  kind,
  createFile: createNewFile,
  createDirectory: createNewDirectory,
  deletePath: (path) => deleteFileOrDirectory(path),
  async renamePath(path, newName) {
    const wsl = parseWslPath(path);
    let targetPath: string;

    if (wsl) {
      const segments = wsl.linuxPath.split("/");
      segments.pop();
      const parentPath = segments.join("/") || "/";
      const targetLinuxPath = joinPath(parentPath, newName);
      targetPath = buildWslPath(wsl.distro, targetLinuxPath);
    } else {
      targetPath = await join(await dirname(path), newName);
    }

    await renameFile(path, targetPath);
    return targetPath;
  },
});

const localMutationProvider = createPlatformMutationProvider("local");
const wslMutationProvider = createPlatformMutationProvider("wsl");

const remoteMutationProvider: WorkspaceEntryMutationProvider = {
  kind: "remote",
  async createFile(directoryPath, fileName) {
    const remote = parseRemotePath(directoryPath);
    if (!remote) {
      throw new Error(`Invalid remote workspace path: ${directoryPath}`);
    }

    const filePath = joinPath(directoryPath, fileName);
    await invoke("ssh_create_file", {
      connectionId: remote.connectionId,
      filePath: joinPath(remote.remotePath, fileName),
    });
    return filePath;
  },
  async createDirectory(parentPath, folderName) {
    const remote = parseRemotePath(parentPath);
    if (!remote) {
      throw new Error(`Invalid remote workspace path: ${parentPath}`);
    }

    const directoryPath = joinPath(parentPath, folderName);
    await invoke("ssh_create_directory", {
      connectionId: remote.connectionId,
      directoryPath: joinPath(remote.remotePath, folderName),
    });
    return directoryPath;
  },
  async deletePath(path, isDirectory) {
    const remote = parseRemotePath(path);
    if (!remote) {
      throw new Error(`Invalid remote workspace path: ${path}`);
    }

    await invoke("ssh_delete_path", {
      connectionId: remote.connectionId,
      targetPath: remote.remotePath,
      isDirectory,
    });
  },
  async renamePath(path, newName) {
    const remote = parseRemotePath(path);
    if (!remote) {
      throw new Error(`Invalid remote workspace path: ${path}`);
    }

    const segments = remote.remotePath.split("/");
    segments.pop();
    const parentPath = segments.join("/") || "/";
    const targetRemotePath = joinPath(parentPath, newName);
    const targetPath = `remote://${remote.connectionId}${targetRemotePath}`;
    await invoke("ssh_rename_path", {
      connectionId: remote.connectionId,
      sourcePath: remote.remotePath,
      targetPath: targetRemotePath,
    });
    return targetPath;
  },
};

export function getWorkspaceEntryMutationProvider(path: string): WorkspaceEntryMutationProvider {
  if (parseRemotePath(path)) {
    return remoteMutationProvider;
  }

  if (parseWslPath(path)) {
    return wslMutationProvider;
  }

  return localMutationProvider;
}
