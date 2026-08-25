import { invoke } from "@tauri-apps/api/core";
import { parseRemotePath } from "@/features/remote/utils/remote-path";
import { parseWslPath } from "@/features/wsl/utils/wsl-path";
import { joinPath } from "@/utils/path-helpers";
import {
  createNewDirectory,
  createNewFile,
  deleteFileOrDirectory,
} from "../controllers/file-operations";

export interface WorkspaceEntryMutationProvider {
  readonly kind: "local" | "remote" | "wsl";
  createFile(directoryPath: string, fileName: string): Promise<string>;
  createDirectory(parentPath: string, folderName: string): Promise<string>;
  deletePath(path: string, isDirectory: boolean): Promise<void>;
}

const createPlatformMutationProvider = (kind: "local" | "wsl"): WorkspaceEntryMutationProvider => ({
  kind,
  createFile: createNewFile,
  createDirectory: createNewDirectory,
  deletePath: (path) => deleteFileOrDirectory(path),
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
