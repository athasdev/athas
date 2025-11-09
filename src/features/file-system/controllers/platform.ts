import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, PhysicalPosition, primaryMonitor } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import {
  BaseDirectory,
  mkdir,
  readDir,
  readTextFile,
  remove,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { isMac } from "@/utils/platform";

// Re-export isMac for convenience
export { isMac };

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

async function getScreenCenter() {
  const window = getCurrentWindow();
  try {
    const windowSize = await window.innerSize();
    const monitor = await primaryMonitor();

    if (!monitor) {
      const position = await window.innerPosition();
      return new PhysicalPosition(position.x, position.y);
    }

    const { width: screenWidth, height: screenHeight } = monitor.size;
    const { x: screenX, y: screenY } = monitor.position;
    // Calculate center position
    const centerX = Math.round(screenX + (screenWidth - windowSize.width) / 2);
    const centerY = Math.round(screenY + (screenHeight - windowSize.height) / 2);

    return new PhysicalPosition(centerX, centerY);
  } catch {
    const position = await window.innerPosition();
    return new PhysicalPosition(position.x, position.y);
  }
}

/**
 * Open a folder selection dialog
 */
export async function openFolder(): Promise<string | null> {
  const appWindow = getCurrentWindow();
  let originalPos: Awaited<ReturnType<typeof appWindow.innerPosition>> | null = null;

  try {
    originalPos = await appWindow.innerPosition();
    const centerPos = await getScreenCenter();
    await appWindow.setPosition(centerPos);

    const selected = await open({
      directory: true,
      multiple: false,
    });

    return selected as string | null;
  } finally {
    if (originalPos) {
      const currentPos = await appWindow.innerPosition();
      if (originalPos.x !== currentPos.x || originalPos.y !== currentPos.y) {
        await appWindow.setPosition(originalPos);
      }
    }
  }
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

/**
 * Cross-platform file rename utility
 * @param sourcePath The current path of the file
 * @param targetPath The new path of the file
 */
export async function renameFile(sourcePath: string, targetPath: string): Promise<void> {
  await invoke("rename_file", { sourcePath, targetPath });
}
