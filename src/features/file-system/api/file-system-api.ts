import { homeDir } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { commands } from "@/bindings/commands";
import { useLinuxFolderPickerStore } from "@/features/file-system/stores/linux-folder-picker.store";
import { invalidateFileTreeGitIgnoreCache } from "@/features/file-explorer/services/file-tree-gitignore";
import { parseWslPath } from "@/features/wsl/utils/wsl-path";
import { stripTrailingPathSeparators } from "@/utils/path-helpers";
import { IS_LINUX } from "@/utils/platform";
import {
  BaseDirectory,
  mkdir,
  readFile as readBinaryFile,
  readDir,
  remove,
} from "@tauri-apps/plugin-fs";

const utf8Decoder = new TextDecoder("utf-8");

async function promptForPath(title: string): Promise<string | null> {
  const defaultPath = await homeDir().catch(() => "");
  const selected = window.prompt(title, defaultPath);
  if (!selected) return null;

  const trimmed = selected.trim();
  if (!trimmed) return null;

  if (trimmed === "~") return defaultPath || null;
  if (trimmed.startsWith("~/") && defaultPath) {
    return `${defaultPath.replace(/[/\\]+$/, "")}/${trimmed.slice(2)}`;
  }

  return trimmed;
}

/**
 * Read a text file from the filesystem
 * @param path The path to the file to read
 */
export async function readFile(path: string): Promise<string> {
  const wslInfo = parseWslPath(path);
  if (wslInfo) {
    return await commands.wslReadFile(wslInfo.distro, wslInfo.linuxPath);
  }

  try {
    const response = await commands.readLocalFile(path);
    return utf8Decoder.decode(new Uint8Array(response));
  } catch {
    const content = await readBinaryFile(path, { baseDir: BaseDirectory.AppData });
    return utf8Decoder.decode(content);
  }
}

export async function getLocalDirectorySize(path: string): Promise<number> {
  return await commands.getLocalDirectorySize(path);
}

/**
 * Write content to a file
 * @param path The path to the file to write
 * @param content The content to write
 */
export async function writeFile(path: string, content: string): Promise<void> {
  const wslInfo = parseWslPath(path);
  if (wslInfo) {
    await commands.wslWriteFile(wslInfo.distro, wslInfo.linuxPath, content);
    invalidateFileTreeGitIgnoreCache(path);
    return;
  }

  await commands.writeLocalFile(path, content);
  invalidateFileTreeGitIgnoreCache(path);
}

/**
 * Create a directory
 * @param path The path to the directory to create
 */
export async function createDirectory(path: string): Promise<void> {
  const wslInfo = parseWslPath(path);
  if (wslInfo) {
    await commands.wslCreateDirectory(wslInfo.distro, wslInfo.linuxPath);
    return;
  }

  await mkdir(path, { recursive: true });
}

/**
 * Delete a file or directory
 * @param path The path to delete
 */
export async function deletePath(path: string): Promise<void> {
  const wslInfo = parseWslPath(path);
  if (wslInfo) {
    await commands.wslDeletePath(wslInfo.distro, wslInfo.linuxPath, true);
    return;
  }

  await remove(path, { recursive: true });
}

/**
 * Open a folder selection dialog
 */
export async function openFolder(): Promise<string | null> {
  try {
    const selected = await open({
      directory: true,
      multiple: false,
    });

    return selected as string | null;
  } catch (error) {
    if (!IS_LINUX) throw error;

    console.warn("Native folder dialog failed, using the Athas folder picker:", error);
    return useLinuxFolderPickerStore.getState().actions.open();
  }
}

/**
 * Open a file selection dialog
 */
export async function openFile(): Promise<string | null> {
  try {
    const selected = await open({
      directory: false,
      multiple: false,
    });

    return selected as string | null;
  } catch (error) {
    if (!IS_LINUX) throw error;

    console.warn("Native file dialog failed, using path entry:", error);
    return promptForPath("File path");
  }
}

/**
 * Open a file selection dialog that allows selecting multiple files.
 */
export async function openFiles(): Promise<string[]> {
  try {
    const selected = await open({
      directory: false,
      multiple: true,
    });

    if (!selected) return [];
    return Array.isArray(selected) ? selected : [selected];
  } catch (error) {
    if (!IS_LINUX) throw error;

    console.warn("Native file dialog failed, using path entry:", error);
    const selected = await promptForPath("File path");
    return selected ? [selected] : [];
  }
}

/**
 * Read the contents of a directory
 * @param path The directory path to read
 */
export async function readDirectory(path: string): Promise<any[]> {
  if (!path) throw new Error("A directory path is required.");
  const wslInfo = parseWslPath(path);
  if (wslInfo) {
    return await commands.wslReadDirectory(wslInfo.distro, wslInfo.linuxPath);
  }

  try {
    const isWindowsPath = /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\") || path === "\\";
    const normalizedPath = isWindowsPath
      ? stripTrailingPathSeparators(path)
      : path.replace(/\/+$/, "") || "/";

    const entries = await readDir(normalizedPath);

    const separator = isWindowsPath && normalizedPath.includes("\\") ? "\\" : "/";
    const prefix = normalizedPath.endsWith(separator)
      ? normalizedPath
      : `${normalizedPath}${separator}`;
    return entries.map((entry) => ({
      name: entry.name,
      path: `${prefix}${entry.name}`,
      is_dir: entry.isDirectory,
      is_symlink: entry.isSymlink,
    }));
  } catch (error) {
    console.error("readDirectory: Error reading directory:", path, error);
    console.error("readDirectory: Error details:", JSON.stringify(error, null, 2));
    throw error;
  }
}

/**
 * Cross-platform file move utility
 * @param sourcePath The path of the file to move
 * @param targetPath The destination path where the file should be moved
 */
export async function moveFile(sourcePath: string, targetPath: string): Promise<void> {
  const sourceWsl = parseWslPath(sourcePath);
  const targetWsl = parseWslPath(targetPath);
  if (sourceWsl || targetWsl) {
    if (!sourceWsl || !targetWsl || sourceWsl.distro !== targetWsl.distro) {
      throw new Error("Moving files between WSL distributions or local folders is not supported.");
    }

    await commands.wslRenamePath(sourceWsl.distro, sourceWsl.linuxPath, targetWsl.linuxPath);
    return;
  }

  await commands.moveFile(sourcePath, targetPath);
}

/**
 * Cross-platform file rename utility
 * @param sourcePath The current path of the file
 * @param targetPath The new path of the file
 */
export async function renameFile(sourcePath: string, targetPath: string): Promise<void> {
  const sourceWsl = parseWslPath(sourcePath);
  const targetWsl = parseWslPath(targetPath);
  if (sourceWsl || targetWsl) {
    if (!sourceWsl || !targetWsl || sourceWsl.distro !== targetWsl.distro) {
      throw new Error(
        "Renaming files between WSL distributions or local folders is not supported.",
      );
    }

    await commands.wslRenamePath(sourceWsl.distro, sourceWsl.linuxPath, targetWsl.linuxPath);
    return;
  }

  await commands.renameFile(sourcePath, targetPath);
}

interface SymlinkInfo {
  is_symlink: boolean;
  target?: string | null;
  is_dir: boolean;
}

/**
 * Get symlink information for a file or directory
 * @param path The path to check
 * @param workspaceRoot The workspace root for relative path calculation
 */
export async function getSymlinkInfo(path: string, workspaceRoot?: string): Promise<SymlinkInfo> {
  const wslInfo = parseWslPath(path);
  if (wslInfo) {
    return await commands.wslGetSymlinkInfo(wslInfo.distro, wslInfo.linuxPath);
  }

  return await commands.getSymlinkInfo(path, workspaceRoot ?? null);
}
