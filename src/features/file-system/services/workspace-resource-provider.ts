import { readFile as readLocalFileBytes } from "@tauri-apps/plugin-fs";
import { commands } from "@/bindings/commands";
import { invalidateFileTreeGitIgnoreCache } from "@/features/file-explorer/lib/file-tree-gitignore";
import { parseRemotePath } from "@/features/remote/utils/remote-path";
import { parseWslPath } from "@/features/wsl/utils/wsl-path";
import { readDirectoryContents, readFileContent } from "../controllers/file-operations";
import { sortFileEntries } from "../controllers/file-tree-utils";
import type { FileEntry } from "../types/app.types";

export interface WorkspaceResourceProvider {
  readonly kind: "local" | "remote" | "wsl";
  readDirectory(path: string, workspaceRoot: string): Promise<FileEntry[]>;
  readText(path: string): Promise<string>;
  writeText(path: string, content: string, expectedContent?: string | null): Promise<void>;
  deleteText(path: string, expectedContent: string): Promise<void>;
  readBytes(path: string): Promise<Uint8Array | null>;
}

const localWorkspaceResourceProvider: WorkspaceResourceProvider = {
  kind: "local",
  async readDirectory(path, workspaceRoot) {
    return sortFileEntries(await readDirectoryContents(path, workspaceRoot));
  },
  readText: readFileContent,
  async writeText(path, content, expectedContent) {
    if (expectedContent !== undefined) {
      await commands.writeLocalFileChecked(path, expectedContent, content);
      invalidateFileTreeGitIgnoreCache(path);
      return;
    }
    const { writeFile } = await import("../controllers/platform");
    await writeFile(path, content);
  },
  async deleteText(path, expectedContent) {
    await commands.deleteLocalFileChecked(path, expectedContent);
    invalidateFileTreeGitIgnoreCache(path);
  },
  readBytes: readLocalFileBytes,
};

const remoteWorkspaceResourceProvider: WorkspaceResourceProvider = {
  kind: "remote",
  async readDirectory(path) {
    const remoteInfo = parseRemotePath(path);
    if (!remoteInfo) {
      throw new Error(`Invalid remote workspace path: ${path}`);
    }

    const entries = await commands.sshReadDirectory(remoteInfo.connectionId, remoteInfo.remotePath);

    return entries.map((entry) => ({
      name: entry.name,
      path: `remote://${remoteInfo.connectionId}${entry.path}`,
      isDir: entry.is_dir,
      children: entry.is_dir ? [] : undefined,
      ...(entry.is_symlink !== undefined
        ? { isSymlink: entry.is_symlink, symlinkTarget: entry.target ?? undefined }
        : {}),
    }));
  },
  async readText(path) {
    const remoteInfo = parseRemotePath(path);
    if (!remoteInfo) {
      throw new Error(`Invalid remote workspace path: ${path}`);
    }

    return await commands.sshReadFile(remoteInfo.connectionId, remoteInfo.remotePath);
  },
  async writeText(path, content, expectedContent) {
    const remoteInfo = parseRemotePath(path);
    if (!remoteInfo) throw new Error(`Invalid remote workspace path: ${path}`);
    if (expectedContent === undefined) {
      await commands.sshWriteFile(remoteInfo.connectionId, remoteInfo.remotePath, content);
    } else {
      await commands.sshWriteFileChecked(
        remoteInfo.connectionId,
        remoteInfo.remotePath,
        content,
        expectedContent,
      );
    }
    invalidateFileTreeGitIgnoreCache(path);
  },
  async deleteText(path, expectedContent) {
    const remoteInfo = parseRemotePath(path);
    if (!remoteInfo) throw new Error(`Invalid remote workspace path: ${path}`);
    await commands.sshDeleteFileChecked(
      remoteInfo.connectionId,
      remoteInfo.remotePath,
      expectedContent,
    );
    invalidateFileTreeGitIgnoreCache(path);
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

    const entries = await commands.wslReadDirectory(wslInfo.distro, wslInfo.linuxPath);

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

    return await commands.wslReadFile(wslInfo.distro, wslInfo.linuxPath);
  },
  async writeText(path, content, expectedContent) {
    const wslInfo = parseWslPath(path);
    if (!wslInfo) throw new Error(`Invalid WSL workspace path: ${path}`);
    if (expectedContent === undefined) {
      await commands.wslWriteFile(wslInfo.distro, wslInfo.linuxPath, content);
    } else {
      await commands.wslWriteFileChecked(
        wslInfo.distro,
        wslInfo.linuxPath,
        content,
        expectedContent,
      );
    }
    invalidateFileTreeGitIgnoreCache(path);
  },
  async deleteText(path, expectedContent) {
    const wslInfo = parseWslPath(path);
    if (!wslInfo) throw new Error(`Invalid WSL workspace path: ${path}`);
    await commands.wslDeleteFileChecked(wslInfo.distro, wslInfo.linuxPath, expectedContent);
    invalidateFileTreeGitIgnoreCache(path);
  },
  async readBytes(path) {
    const wslInfo = parseWslPath(path);
    if (!wslInfo) {
      throw new Error(`Invalid WSL workspace path: ${path}`);
    }

    const bytes = await commands.wslReadFileBytes(wslInfo.distro, wslInfo.linuxPath);
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
