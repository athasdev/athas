import type { FileEntry } from "@/features/file-system/types/app.types";
import { getRelativePath, normalizePath } from "@/utils/path-helpers";
import type { DatabaseType } from "../types/provider.types";
import type { SavedConnection } from "../stores/connection.store";
import { getDatabaseTypeForFilePath } from "./database-file-drop";

export interface WorkspaceDatabaseFile {
  id: string;
  path: string;
  name: string;
  dbType: DatabaseType;
  relativePath: string;
}

function getBaseName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export function getDatabaseFilePathKey(path: string) {
  return normalizePath(path).toLowerCase();
}

function flattenFiles(entries: FileEntry[], files: FileEntry[] = []) {
  for (const entry of entries) {
    if (entry.isDir) {
      flattenFiles(entry.children ?? [], files);
      continue;
    }

    files.push(entry);
  }

  return files;
}

export function getSavedFileConnectionPathKeys(connections: SavedConnection[]) {
  return new Set(
    connections
      .map((connection) => connection.file_path?.trim())
      .filter((path): path is string => !!path)
      .map(getDatabaseFilePathKey),
  );
}

export function getWorkspaceDatabaseFiles(
  entries: FileEntry[],
  rootFolderPath: string,
  savedConnectionPathKeys: Set<string> = new Set(),
): WorkspaceDatabaseFile[] {
  const seenPaths = new Set<string>();
  const databaseFiles: WorkspaceDatabaseFile[] = [];

  for (const file of flattenFiles(entries)) {
    const dbType = getDatabaseTypeForFilePath(file.path);
    if (!dbType) continue;

    const pathKey = getDatabaseFilePathKey(file.path);
    if (seenPaths.has(pathKey) || savedConnectionPathKeys.has(pathKey)) continue;
    seenPaths.add(pathKey);

    const relativePath = getRelativePath(file.path, rootFolderPath);
    databaseFiles.push({
      id: `workspace-file:${pathKey}`,
      path: file.path,
      name: file.name || getBaseName(file.path),
      dbType,
      relativePath,
    });
  }

  return databaseFiles.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
}
