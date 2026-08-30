import type { PaneContent } from "@/features/panes/types/pane-content.types";
import type { GitFile, GitStatus } from "@/features/git/types/git.types";

const GITHUB_CONTEXT_TYPES = new Set<PaneContent["type"]>([
  "pullRequest",
  "githubIssue",
  "githubAction",
]);

export interface GitContextFile extends GitFile {
  absolutePath: string;
}

export function isGitHubContextBuffer(buffer: PaneContent) {
  return GITHUB_CONTEXT_TYPES.has(buffer.type);
}

export function getSelectableContextBuffers(buffers: PaneContent[]) {
  return buffers.filter((buffer) => buffer.type !== "agent" && buffer.type !== "newTab");
}

export function groupContextBuffers(buffers: PaneContent[]) {
  const selectableBuffers = getSelectableContextBuffers(buffers);

  return {
    github: selectableBuffers.filter(isGitHubContextBuffer),
    openTabs: selectableBuffers.filter((buffer) => !isGitHubContextBuffer(buffer)),
  };
}

export function resolveGitContextPath(repoPath: string, filePath: string) {
  if (filePath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(filePath)) return filePath;

  const root = repoPath.replace(/[/\\]+$/, "");
  const relativePath = filePath.replace(/^[/\\]+/, "");
  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return `${root}${separator}${relativePath}`;
}

export function getGitContextFiles(status: GitStatus | null, repoPath: string | null) {
  if (!status || !repoPath) return [];

  const filesByPath = new Map<string, GitContextFile>();

  for (const file of status.files) {
    if (file.status === "deleted") continue;

    const absolutePath = resolveGitContextPath(repoPath, file.path);
    const current = filesByPath.get(absolutePath);
    filesByPath.set(absolutePath, {
      ...file,
      staged: Boolean(current?.staged || file.staged),
      absolutePath,
    });
  }

  return Array.from(filesByPath.values()).sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}
