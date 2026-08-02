import type { GitFile } from "../types/git.types";

export type GitStatusGroup = "added" | "modified" | "deleted" | "renamed" | "untracked";

export const GIT_STATUS_ORDER: GitStatusGroup[] = [
  "added",
  "modified",
  "deleted",
  "renamed",
  "untracked",
];

export interface GitFolderNode {
  name: string;
  fullPath: string;
  folders: Map<string, GitFolderNode>;
  files: GitFile[];
  descendantFiles: GitFile[];
  sortedFolders: GitFolderNode[];
  sortedFiles: GitFile[];
  descendantFilePaths: string[];
  areAllDescendantFilesStaged: boolean;
}

export interface GitStatusPresentation {
  stagedFiles: GitFile[];
  unstagedFiles: GitFile[];
  hasStagedDiffableFiles: boolean;
  hasUnstagedDiffableFiles: boolean;
  visibleFiles: GitFile[];
  displayFileByPath: Map<string, GitFile>;
  trackedFiles: GitFile[];
  untrackedFiles: GitFile[];
  groupedTrackedFiles: Record<GitStatusGroup, GitFile[]>;
  groupedUntrackedFiles: Record<GitStatusGroup, GitFile[]>;
}

const createEmptyGitStatusGroups = (): Record<GitStatusGroup, GitFile[]> => ({
  added: [],
  modified: [],
  deleted: [],
  renamed: [],
  untracked: [],
});

const createFolderNode = (name: string, fullPath: string): GitFolderNode => ({
  name,
  fullPath,
  folders: new Map<string, GitFolderNode>(),
  files: [],
  descendantFiles: [],
  sortedFolders: [],
  sortedFiles: [],
  descendantFilePaths: [],
  areAllDescendantFilesStaged: false,
});

const normalizePathSegments = (path: string): string[] =>
  path
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

function finalizeGitFolderTree(node: GitFolderNode): void {
  for (const folderNode of node.folders.values()) {
    finalizeGitFolderTree(folderNode);
  }

  node.sortedFolders = Array.from(node.folders.values()).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  node.sortedFiles = [...node.files].sort((left, right) => left.path.localeCompare(right.path));
  node.descendantFilePaths = node.descendantFiles.map((file) => file.path);
  node.areAllDescendantFilesStaged =
    node.descendantFiles.length > 0 && node.descendantFiles.every((file) => file.staged);
}

export function buildGitFolderTree(fileList: GitFile[]): GitFolderNode {
  const root = createFolderNode("", "");

  for (const file of fileList) {
    const segments = normalizePathSegments(file.path);
    if (segments.length === 0) continue;

    let currentNode = root;
    currentNode.descendantFiles.push(file);
    let currentPath = "";

    for (const segment of segments.slice(0, -1)) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      let folder = currentNode.folders.get(segment);
      if (!folder) {
        folder = createFolderNode(segment, currentPath);
        currentNode.folders.set(segment, folder);
      }
      currentNode = folder;
      currentNode.descendantFiles.push(file);
    }

    currentNode.files.push(file);
  }

  finalizeGitFolderTree(root);
  return root;
}

export function buildGitStatusPresentation(files: GitFile[]): GitStatusPresentation {
  const stagedFiles: GitFile[] = [];
  const unstagedFiles: GitFile[] = [];
  const displayFileByPath = new Map<string, GitFile>();
  let hasStagedDiffableFiles = false;
  let hasUnstagedDiffableFiles = false;

  for (const file of files) {
    if (file.staged) {
      stagedFiles.push(file);
      hasStagedDiffableFiles ||= file.status !== "untracked";
    } else {
      unstagedFiles.push(file);
      hasUnstagedDiffableFiles ||= file.status !== "untracked";
    }

    const existingFile = displayFileByPath.get(file.path);
    if (!existingFile || (!existingFile.staged && file.staged)) {
      displayFileByPath.set(file.path, file);
    }
  }

  const visibleFiles = Array.from(displayFileByPath.values());
  const trackedFiles: GitFile[] = [];
  const untrackedFiles: GitFile[] = [];
  const groupedTrackedFiles = createEmptyGitStatusGroups();
  const groupedUntrackedFiles = createEmptyGitStatusGroups();

  for (const file of visibleFiles) {
    if (file.status === "untracked") {
      untrackedFiles.push(file);
      groupedUntrackedFiles.untracked.push(file);
    } else {
      trackedFiles.push(file);
      groupedTrackedFiles[file.status].push(file);
    }
  }

  return {
    stagedFiles,
    unstagedFiles,
    hasStagedDiffableFiles,
    hasUnstagedDiffableFiles,
    visibleFiles,
    displayFileByPath,
    trackedFiles,
    untrackedFiles,
    groupedTrackedFiles,
    groupedUntrackedFiles,
  };
}
