import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { getFileDiff } from "@/features/git/api/git-diff-api";
import type { MultiFileDiff } from "@/features/git/types/git-diff.types";
import { countDiffStats } from "@/features/git/utils/git-diff-helpers";
import { openGitWorktreeWorkspace } from "@/features/git/utils/git-worktree-open";
import { openCommitDiffBuffer } from "@/features/git/utils/open-commit-diff-buffer";
import { getFolderName } from "@/utils/path-helpers";
import type { SidebarDragResource } from "./sidebar-resource-drag";

const normalizeGitFilePath = (filePath: string, staged: boolean): string => {
  let actualFilePath = filePath;

  if (filePath.includes(" -> ")) {
    const parts = filePath.split(" -> ");
    actualFilePath = (staged ? parts[1] : parts[0])?.trim() || filePath;
  }

  if (actualFilePath.startsWith('"') && actualFilePath.endsWith('"')) {
    actualFilePath = actualFilePath.slice(1, -1);
  }

  return actualFilePath;
};

const openWorkingTreeDiffBuffer = async (
  resource: Extract<SidebarDragResource, { type: "git-file-diff" }>,
): Promise<string | null> => {
  const actualFilePath = normalizeGitFilePath(resource.filePath, resource.staged);

  if (resource.status === "untracked" && !resource.staged) {
    await useFileSystemStore
      .getState()
      .handleFileOpen(`${resource.repoPath}/${actualFilePath}`, false);
    return useBufferStore.getState().activeBufferId;
  }

  const diff = await getFileDiff(resource.repoPath, actualFilePath, resource.staged);
  if (!diff || (diff.lines.length === 0 && diff.is_image !== true)) {
    await useFileSystemStore
      .getState()
      .handleFileOpen(`${resource.repoPath}/${actualFilePath}`, false);
    return useBufferStore.getState().activeBufferId;
  }

  const { additions, deletions } = countDiffStats([diff]);
  const fileKey = `${resource.staged ? "staged" : "unstaged"}:${actualFilePath}`;
  const multiDiff: MultiFileDiff = {
    title: "Uncommitted Changes",
    repoPath: resource.repoPath,
    commitHash: "working-tree",
    files: [diff],
    totalFiles: 1,
    totalAdditions: additions,
    totalDeletions: deletions,
    fileKeys: [fileKey],
    initiallyExpandedFileKey: fileKey,
  };

  const encodedPath = encodeURIComponent(actualFilePath);
  const virtualPath = `diff://working-tree/${resource.staged ? "staged" : "unstaged"}/${encodedPath}`;
  const displayName = `${getFolderName(actualFilePath)}.diff`;

  return useBufferStore
    .getState()
    .actions.openBuffer(virtualPath, displayName, "", false, undefined, true, true, multiDiff);
};

const openSidebarCommitDiffBuffer = async (
  resource: Extract<SidebarDragResource, { type: "git-commit" }>,
): Promise<string | null> => {
  return openCommitDiffBuffer({
    repoPath: resource.repoPath,
    commitHash: resource.commitHash,
    message: resource.message,
    author: resource.author,
    date: resource.date,
  });
};

export const openSidebarResourceBuffer = async (
  resource: SidebarDragResource,
): Promise<string | null> => {
  const bufferActions = useBufferStore.getState().actions;

  switch (resource.type) {
    case "file":
      if (resource.isDir) {
        return null;
      }
      await useFileSystemStore.getState().handleFileOpen(resource.path, false);
      return useBufferStore.getState().activeBufferId;

    case "git-file-diff":
      return openWorkingTreeDiffBuffer(resource);

    case "git-commit":
      return openSidebarCommitDiffBuffer(resource);

    case "git-worktree":
      await openGitWorktreeWorkspace(resource.path);
      return null;

    case "github-pr":
      return bufferActions.openPRBuffer(resource.number, {
        title: resource.title,
        repoPath: resource.repoPath,
        authorAvatarUrl: resource.authorAvatarUrl,
      });

    case "github-issue":
      return bufferActions.openGitHubIssueBuffer({
        issueNumber: resource.number,
        repoPath: resource.repoPath,
        title: resource.title,
        authorAvatarUrl: resource.authorAvatarUrl,
        url: resource.url,
      });

    case "github-action":
      return bufferActions.openGitHubActionBuffer({
        runId: resource.runId,
        repoPath: resource.repoPath,
        title: resource.title,
        url: resource.url,
      });
  }
};
