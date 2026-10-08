import type { FileEntry } from "../types/app.types";
import { getDirName } from "@/utils/path-helpers";

export function sortFileEntries(entries: FileEntry[]): FileEntry[] {
  return entries.sort((a, b) => {
    // Directories come first
    if (a.isDir && !b.isDir) return -1;
    if (!a.isDir && b.isDir) return 1;

    // Then sort alphabetically (case-insensitive)
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
}

const SLASH = 47;
const BACKSLASH = 92;

/**
 * Whether `targetPath` lies below the directory at `dirPath`. Every entry's path extends its
 * parent's, so tree walks only descend into the one branch that can hold the target and stay
 * O(depth x siblings) instead of visiting every loaded entry.
 */
export function isPathInsideTreeEntry(targetPath: string, dirPath: string): boolean {
  if (targetPath.length <= dirPath.length || !targetPath.startsWith(dirPath)) return false;
  const last = dirPath.charCodeAt(dirPath.length - 1);
  if (last === SLASH || last === BACKSLASH) return true;
  const next = targetPath.charCodeAt(dirPath.length);
  return next === SLASH || next === BACKSLASH;
}

/**
 * The entry moved to `newPath`, with every loaded descendant's path rewritten under it. Tree
 * walks prune by path prefix, so descendants left with the old prefix would become unreachable
 * for later refreshes and deletes.
 */
export function relocateFileEntry(entry: FileEntry, newPath: string, newName: string): FileEntry {
  const oldPath = entry.path;
  const rewrite = (item: FileEntry, path: string): FileEntry => {
    const next: FileEntry = { ...item, path };
    if (item.children) {
      next.children = item.children.map((child) =>
        rewrite(
          child,
          child.path.startsWith(oldPath) ? newPath + child.path.slice(oldPath.length) : child.path,
        ),
      );
    }
    return next;
  };
  return { ...rewrite(entry, newPath), name: newName };
}

export function findFileInTree(files: FileEntry[], targetPath: string): FileEntry | null {
  for (const file of files) {
    if (file.path === targetPath) {
      return file;
    }
    if (isPathInsideTreeEntry(targetPath, file.path) && file.children) {
      const found = findFileInTree(file.children, targetPath);
      if (found) return found;
    }
  }
  return null;
}

export function updateFileInTree(
  files: FileEntry[],
  targetPath: string,
  updater: (file: FileEntry) => FileEntry,
): FileEntry[] {
  let updatedFiles: FileEntry[] | null = null;
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    let updatedFile = file;
    if (file.path === targetPath) {
      updatedFile = updater(file);
    } else if (isPathInsideTreeEntry(targetPath, file.path) && file.children) {
      const updatedChildren = updateFileInTree(file.children, targetPath, updater);
      if (updatedChildren !== file.children) {
        updatedFile = { ...file, children: updatedChildren };
      }
    }
    if (updatedFile !== file) {
      updatedFiles ??= files.slice();
      updatedFiles[index] = updatedFile;
    }
  }
  return updatedFiles ?? files;
}

export function removeFileFromTree(files: FileEntry[], targetPath: string): FileEntry[] {
  let changed = false;
  const nextFiles: FileEntry[] = [];

  for (const file of files) {
    if (file.path === targetPath) {
      changed = true;
      continue;
    }

    if (isPathInsideTreeEntry(targetPath, file.path) && file.children) {
      const updatedChildren = removeFileFromTree(file.children, targetPath);
      if (updatedChildren !== file.children) {
        changed = true;
        nextFiles.push({
          ...file,
          children: updatedChildren,
        });
        continue;
      }
    }

    nextFiles.push(file);
  }

  return changed ? nextFiles : files;
}

function isDirectoryChildrenRoot(files: FileEntry[], parentPath: string): boolean {
  if (files.length === 0 || !files[0].path) return false;
  return parentPath === getDirName(files[0].path);
}

function appendSortedFile(files: FileEntry[], newFile: FileEntry): FileEntry[] {
  return sortFileEntries([...files, newFile]);
}

export function addFileToTree(
  files: FileEntry[],
  parentPath: string,
  newFile: FileEntry,
): FileEntry[] {
  // If parentPath is empty or root, add to top level
  if (!parentPath || parentPath === "/" || parentPath === "\\") {
    return appendSortedFile(files, newFile);
  }

  // Check if parentPath matches the root folder (when files are direct children of parentPath)
  // This happens when creating files in the root directory
  if (isDirectoryChildrenRoot(files, parentPath)) {
    return appendSortedFile(files, newFile);
  }

  let result: FileEntry[] | null = null;
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    let updatedFile = file;
    if (file.path === parentPath && file.isDir) {
      updatedFile = { ...file, children: appendSortedFile(file.children || [], newFile) };
    } else if (isPathInsideTreeEntry(parentPath, file.path) && file.children) {
      const updatedChildren = addFileToTree(file.children, parentPath, newFile);
      if (updatedChildren !== file.children) {
        updatedFile = { ...file, children: updatedChildren };
      }
    }
    if (updatedFile !== file) {
      result ??= files.slice();
      result[index] = updatedFile;
    }
  }
  return result ?? files;
}
