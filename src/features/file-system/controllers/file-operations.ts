import type { FileEntry } from "../types/app";
import {
  getSymlinkInfo,
  createDirectory as platformCreateDirectory,
  deletePath as platformDeletePath,
  readDirectory as platformReadDirectory,
  readFile as platformReadFile,
  writeFile as platformWriteFile,
} from "./platform";
import { useFileSystemStore } from "./store";
import { shouldIgnore } from "./utils";

export async function readFileContent(path: string): Promise<string> {
  try {
    const content = await platformReadFile(path);
    return content || "";
  } catch (error) {
    throw new Error(`Failed to read file ${path}: ${error}`);
  }
}

async function writeFileContent(path: string, content: string): Promise<void> {
  try {
    await platformWriteFile(path, content);
  } catch (error) {
    throw new Error(`Failed to write file ${path}: ${error}`);
  }
}

export async function createNewFile(directoryPath: string, fileName: string): Promise<string> {
  if (!directoryPath || directoryPath.trim() === "") {
    throw new Error("Directory path cannot be empty");
  }
  if (!fileName || fileName.trim() === "") {
    throw new Error("File name cannot be empty");
  }

  const filePath = `${directoryPath}/${fileName}`;
  await writeFileContent(filePath, "");
  return filePath;
}

export async function createNewDirectory(parentPath: string, folderName: string): Promise<string> {
  if (!parentPath || parentPath.trim() === "") {
    throw new Error("Parent path cannot be empty");
  }
  if (!folderName || folderName.trim() === "") {
    throw new Error("Folder name cannot be empty");
  }

  const folderPath = `${parentPath}/${folderName}`;
  await platformCreateDirectory(folderPath);
  return folderPath;
}

export async function deleteFileOrDirectory(path: string): Promise<void> {
  await platformDeletePath(path);
}

export async function readDirectoryContents(path: string): Promise<FileEntry[]> {
  try {
    const entries = await platformReadDirectory(path);
    const workspaceRoot = useFileSystemStore.getState().rootFolderPath;

    const filteredEntries = (entries as any[]).filter((entry: any) => {
      const name = entry.name || "Unknown";
      const isDir = entry.is_dir || false;
      return !shouldIgnore(name, isDir);
    });

    const entriesWithSymlinkInfo = await Promise.all(
      filteredEntries.map(async (entry: any) => {
        const entryPath = entry.path || `${path}/${entry.name}`;

        try {
          const symlinkInfo = await getSymlinkInfo(entryPath, workspaceRoot);

          return {
            name: entry.name || "Unknown",
            path: entryPath,
            isDir: symlinkInfo.is_symlink ? false : entry.is_dir || false,
            children: undefined,
            isSymlink: symlinkInfo.is_symlink,
            symlinkTarget: symlinkInfo.target,
          };
        } catch (error) {
          console.error(`Failed to get symlink info for ${entryPath}:`, error);
          return {
            name: entry.name || "Unknown",
            path: entryPath,
            isDir: entry.is_dir || false,
            children: undefined,
          };
        }
      }),
    );

    return entriesWithSymlinkInfo;
  } catch (error) {
    throw new Error(`Failed to read directory ${path}: ${error}`);
  }
}
