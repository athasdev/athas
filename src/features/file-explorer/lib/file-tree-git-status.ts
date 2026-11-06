import type { FileEntry } from "@/features/file-system/types/app.types";
import type { GitFile, GitStatus } from "@/features/git/types/git.types";
import { getRelativePath } from "@/utils/path-helpers";

export interface FileTreeGitStatusDecoration {
  colorClassName: string;
  label: string;
}

export interface FileTreeGitStatusLookup {
  files: Map<string, FileTreeGitStatusDecoration>;
  directories: Map<string, FileTreeGitStatusDecoration>;
  /**
   * Folders Git reports as a whole (`new-folder/`) instead of file by file, such as an
   * untracked folder. Everything under them shares their status.
   */
  wholeDirectories: Map<string, FileTreeGitStatusDecoration>;
}

const gitStatusPriority: Record<GitFile["status"], number> = {
  deleted: 50,
  modified: 40,
  renamed: 30,
  added: 20,
  untracked: 10,
};

function getGitStatusPriority(gitFile: GitFile): number {
  const priority = gitStatusPriority[gitFile.status] ?? 0;
  return gitFile.status === "modified" && gitFile.staged ? priority + 1 : priority;
}

export function getFileTreeGitStatusDecoration(
  gitFile: GitFile,
): FileTreeGitStatusDecoration | null {
  switch (gitFile.status) {
    case "modified":
      return {
        colorClassName: gitFile.staged ? "text-git-modified-staged" : "text-git-modified",
        label: gitFile.staged ? "Modified (staged)" : "Modified",
      };
    case "added":
      return { colorClassName: "text-git-added", label: "Added" };
    case "deleted":
      return { colorClassName: "text-git-deleted", label: "Deleted" };
    case "untracked":
      return { colorClassName: "text-git-untracked", label: "Untracked" };
    case "renamed":
      return { colorClassName: "text-git-renamed", label: "Renamed" };
    default:
      return null;
  }
}

export function createFileTreeGitStatusLookup(gitStatus: GitStatus): FileTreeGitStatusLookup {
  const files = new Map<string, FileTreeGitStatusDecoration>();
  const directories = new Map<string, FileTreeGitStatusDecoration>();
  const wholeDirectories = new Map<string, FileTreeGitStatusDecoration>();
  const directoryPriorities = new Map<string, number>();

  for (const gitFile of gitStatus.files) {
    const statusDecoration = getFileTreeGitStatusDecoration(gitFile);
    if (!statusDecoration) continue;

    if (gitFile.path.endsWith("/")) {
      wholeDirectories.set(gitFile.path.replace(/\/+$/, ""), statusDecoration);
    } else {
      files.set(gitFile.path, statusDecoration);
    }

    const segments = gitFile.path.split("/");
    let currentPath = "";
    for (let index = 0; index < segments.length - 1; index++) {
      currentPath = currentPath ? `${currentPath}/${segments[index]}` : segments[index];
      const nextPriority = getGitStatusPriority(gitFile);
      const currentPriority = directoryPriorities.get(currentPath) ?? -1;
      if (nextPriority > currentPriority) {
        directories.set(currentPath, statusDecoration);
        directoryPriorities.set(currentPath, nextPriority);
      }
    }
  }

  return { files, directories, wholeDirectories };
}

function findWholeDirectoryStatus(
  relativePath: string,
  lookup: FileTreeGitStatusLookup,
): FileTreeGitStatusDecoration | null {
  if (lookup.wholeDirectories.size === 0) return null;
  let separatorIndex = relativePath.indexOf("/");
  while (separatorIndex > 0) {
    const status = lookup.wholeDirectories.get(relativePath.slice(0, separatorIndex));
    if (status) return status;
    separatorIndex = relativePath.indexOf("/", separatorIndex + 1);
  }
  return null;
}

export function getFileTreeEntryGitStatusDecoration(
  file: FileEntry,
  rootFolderPath: string | undefined,
  lookup: FileTreeGitStatusLookup | null,
): FileTreeGitStatusDecoration | null {
  if (!rootFolderPath || !lookup) return null;

  const relativePath = getRelativePath(file.path, rootFolderPath);
  if (!relativePath) return null;

  const fileStatus = lookup.files.get(relativePath);
  if (fileStatus) return fileStatus;

  const insideWholeDirectory = findWholeDirectoryStatus(relativePath, lookup);
  if (insideWholeDirectory) return insideWholeDirectory;

  if (file.isDir) {
    return (
      lookup.wholeDirectories.get(relativePath) || lookup.directories.get(relativePath) || null
    );
  }

  return null;
}
