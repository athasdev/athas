import type ignore from "ignore";
import type { FileEntry } from "@/features/file-system/types/app";
import type { GitFile, GitStatus } from "@/features/version-control/git/types/git";
import { getRelativePath } from "@/utils/path-helpers";

export function filterHiddenFiles(
  items: FileEntry[],
  isUserHidden: (path: string, isDir: boolean) => boolean,
  isGitIgnored: (path: string, isDir: boolean) => boolean,
): FileEntry[] {
  return items
    .filter((item) => !isUserHidden(item.path, item.isDir))
    .map((item) => ({
      ...item,
      ignored: isGitIgnored(item.path, item.isDir),
      children: item.children
        ? filterHiddenFiles(item.children, isUserHidden, isGitIgnored)
        : undefined,
    }));
}

export function getGitFileStatus(
  filePath: string,
  gitStatus: GitStatus | null,
  rootFolderPath: string | undefined,
): GitFile | null {
  if (!gitStatus || !rootFolderPath) return null;
  const relativePath = getRelativePath(filePath, rootFolderPath);
  return gitStatus.files.find((file) => file.path === relativePath) || null;
}

export function hasGitChangesInDirectory(
  dirPath: string,
  gitStatus: GitStatus | null,
  rootFolderPath: string | undefined,
): GitFile | null {
  if (!gitStatus || !rootFolderPath) return null;
  const relativeDirPath = getRelativePath(dirPath, rootFolderPath);
  return (
    gitStatus.files.find(
      (file) => file.path.startsWith(`${relativeDirPath}/`) || file.path === relativeDirPath,
    ) || null
  );
}

export function getGitStatusColorClass(
  file: FileEntry,
  gitStatus: GitStatus | null,
  rootFolderPath: string | undefined,
): string {
  const gitFile = getGitFileStatus(file.path, gitStatus, rootFolderPath);

  if (gitFile) {
    switch (gitFile.status) {
      case "modified":
        return gitFile.staged ? "text-git-modified-staged" : "text-git-modified";
      case "added":
        return "text-git-added";
      case "deleted":
        return "text-git-deleted";
      case "untracked":
        return "text-git-untracked";
      case "renamed":
        return "text-git-renamed";
      default:
        return "";
    }
  }

  if (file.isDir) {
    const dirChange = hasGitChangesInDirectory(file.path, gitStatus, rootFolderPath);
    if (dirChange) {
      switch (dirChange.status) {
        case "modified":
          return dirChange.staged ? "text-git-modified-staged" : "text-git-modified";
        case "added":
          return "text-git-added";
        case "deleted":
          return "text-git-deleted";
        case "untracked":
          return "text-git-untracked";
        case "renamed":
          return "text-git-renamed";
        default:
          return "";
      }
    }
  }

  return "";
}

export function createUserIgnoreChecker(
  userIgnore: ReturnType<typeof ignore>,
  rootFolderPath: string | undefined,
): (fullPath: string, isDir: boolean) => boolean {
  return (fullPath: string, isDir: boolean): boolean => {
    let relative = getRelativePath(fullPath, rootFolderPath);
    if (!relative || relative.trim() === "") return false;
    if (isDir && !relative.endsWith("/")) relative += "/";
    return userIgnore.ignores(relative);
  };
}

export function createGitIgnoreChecker(
  gitIgnore: ReturnType<typeof ignore> | null,
  rootFolderPath: string | undefined,
): (fullPath: string, isDir: boolean) => boolean {
  return (fullPath: string, isDir: boolean): boolean => {
    if (!gitIgnore || !rootFolderPath) return false;
    let relative = getRelativePath(fullPath, rootFolderPath);
    if (!relative || relative.trim() === "") return false;
    if (isDir && !relative.endsWith("/")) relative += "/";
    if (relative === ".git/" || relative === ".git") return false;
    return gitIgnore.ignores(relative);
  };
}

export function addNewItemToTree(
  items: FileEntry[],
  targetPath: string,
  newItem: FileEntry,
): FileEntry[] {
  return items.map((item) => {
    if (item.path === targetPath && item.isDir) {
      return {
        ...item,
        children: [...(item.children || []), newItem],
      };
    }
    if (item.children) {
      return {
        ...item,
        children: addNewItemToTree(item.children, targetPath, newItem),
      };
    }
    return item;
  });
}

export function removeEditingItemsFromTree(items: FileEntry[]): FileEntry[] {
  return items
    .filter((item) => !(item.isNewItem && item.isEditing))
    .map((item) => ({
      ...item,
      children: item.children ? removeEditingItemsFromTree(item.children) : undefined,
    }));
}
