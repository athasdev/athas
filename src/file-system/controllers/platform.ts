import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  BaseDirectory,
  mkdir,
  readDir,
  readTextFile,
  remove,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { type } from "@tauri-apps/plugin-os";

/**
 * Check if the current platform is macOS
 */
export const isMac = () => type() === "macos";

/**
 * Read a text file from the filesystem
 * @param path The path to the file to read
 */
export async function readFile(path: string): Promise<string> {
  try {
    // Try to read as absolute path first
    return await readTextFile(path);
  } catch {
    // Fallback to reading from app data directory
    return await readTextFile(path, { baseDir: BaseDirectory.AppData });
  }
}

/**
 * Write content to a file
 * @param path The path to the file to write
 * @param content The content to write
 */
export async function writeFile(path: string, content: string): Promise<void> {
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
  await mkdir(path, { recursive: true });
}

/**
 * Delete a file or directory
 * @param path The path to delete
 */
export async function deletePath(path: string): Promise<void> {
  await remove(path, { recursive: true });
}

/**
 * Open a folder selection dialog
 */
export async function openFolder(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
  });

  return selected as string | null;
}

/**
 * Read the contents of a directory
 * @param path The directory path to read
 */
export async function readDirectory(path: string): Promise<any[]> {
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
  await invoke("move_file", { sourcePath, targetPath });
}
