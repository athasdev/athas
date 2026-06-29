import { invoke } from "@tauri-apps/api/core";
import { homeDir } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { useLinuxFolderPickerStore } from "@/features/file-system/stores/linux-folder-picker.store";
import { parseWslPath } from "@/features/wsl/utils/wsl-path";
import { IS_LINUX } from "@/utils/platform";
import {
  BaseDirectory,
  mkdir,
  readFile as readBinaryFile,
  readDir,
  remove,
  writeTextFile,
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
    return await invoke<string>("wsl_read_file", {
      distro: wslInfo.distro,
      filePath: wslInfo.linuxPath,
    });
  }

  try {
    const content = await readBinaryFile(path);
    return utf8Decoder.decode(content);
  } catch {
    const content = await readBinaryFile(path, { baseDir: BaseDirectory.AppData });
    return utf8Decoder.decode(content);
  }
}

/**
 * Write content to a file
 * @param path The path to the file to write
 * @param content The content to write
 */
export async function writeFile(path: string, content: string): Promise<void> {
  const wslInfo = parseWslPath(path);
  if (wslInfo) {
    await invoke("wsl_write_file", {
      distro: wslInfo.distro,
      filePath: wslInfo.linuxPath,
      content,
    });
    return;
  }

  try {
    // Try to write as absolute path first
    await writeTextFile(path, content);
  } catch {
    // Fallback to writing to app data directory
    await writeTextFile(path, content, { baseDir: BaseDirectory.AppData });
  }
}

/**
 * Create a directory
 * @param path The path to the directory to create
 */
export async function createDirectory(path: string): Promise<void> {
  const wslInfo = parseWslPath(path);
  if (wslInfo) {
    await invoke("wsl_create_directory", {
      distro: wslInfo.distro,
      directoryPath: wslInfo.linuxPath,
    });
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
    await invoke("wsl_delete_path", {
      distro: wslInfo.distro,
      targetPath: wslInfo.linuxPath,
      isDirectory: true,
    });
    return;
  }

  await remove(path, { recursive: true });
}

/**
 * Open a folder selection dialog
 */
export async function openFolder(): Promise<string | null> {
  if (IS_LINUX) {
    return useLinuxFolderPickerStore.getState().actions.open();
  }

  const selected = await open({
    directory: true,
    multiple: false,
  });

  return selected as string | null;
}

/**
 * Open a file selection dialog
 */
export async function openFile(): Promise<string | null> {
  if (IS_LINUX) {
    return promptForPath("File path");
  }

  const selected = await open({
    directory: false,
    multiple: false,
  });

  return selected as string | null;
}

/**
 * Read the contents of a directory
 * @param path The directory path to read
 */
export async function readDirectory(path: string): Promise<any[]> {
  const wslInfo = parseWslPath(path);
  if (wslInfo) {
    const entries = await invoke<
      Array<{
        name: string;
        path: string;
        is_dir: boolean;
        size: number;
        is_symlink: boolean;
        target?: string | null;
      }>
    >("wsl_read_directory", {
      distro: wslInfo.distro,
      path: wslInfo.linuxPath,
    });
    return entries;
  }

  try {
    // Normalize the path - remove any trailing slashes
    const normalizedPath = path.replace(/[/\\]+$/, "");

    const entries = await readDir(normalizedPath);

    // Use the appropriate path separator based on the input path
    const separator = normalizedPath.includes("\\") ? "\\" : "/";
    return entries.map((entry) => ({
      name: entry.name,
      path: `${normalizedPath}${separator}${entry.name}`,
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

    await invoke("wsl_rename_path", {
      distro: sourceWsl.distro,
      sourcePath: sourceWsl.linuxPath,
      targetPath: targetWsl.linuxPath,
    });
    return;
  }

  await invoke("move_file", { sourcePath, targetPath });
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

    await invoke("wsl_rename_path", {
      distro: sourceWsl.distro,
      sourcePath: sourceWsl.linuxPath,
      targetPath: targetWsl.linuxPath,
    });
    return;
  }

  await invoke("rename_file", { sourcePath, targetPath });
}

export interface SymlinkInfo {
  is_symlink: boolean;
  target?: string;
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
    return await invoke("wsl_get_symlink_info", {
      distro: wslInfo.distro,
      path: wslInfo.linuxPath,
    });
  }

  return await invoke("get_symlink_info", { path, workspaceRoot });
}
