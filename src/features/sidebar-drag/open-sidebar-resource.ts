import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { getCommitDiff, getFileDiff } from "@/features/git/api/git-diff-api";
import type { MultiFileDiff } from "@/features/git/types/git-diff-types";
import { countDiffStats } from "@/features/git/utils/git-diff-helpers";
import { useRepositoryStore } from "@/features/git/stores/git-repository-store";
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

const openCommitDiffBuffer = async (
  resource: Extract<SidebarDragResource, { type: "git-commit" }>,
): Promise<string | null> => {
  const diffs = await getCommitDiff(resource.repoPath, resource.commitHash);
  if (!diffs || diffs.length === 0) {
    return null;
  }

  const { additions, deletions } = countDiffStats(diffs);
  const multiDiff: MultiFileDiff = {
    title: `Commit ${resource.commitHash.substring(0, 7)}`,
    repoPath: resource.repoPath,
    commitHash: resource.commitHash,
    commitMessage: resource.message,
    commitAuthor: resource.author,
    commitDate: resource.date,
    files: diffs,
    totalFiles: diffs.length,
    totalAdditions: additions,
    totalDeletions: deletions,
  };

  const virtualPath = `diff://commit/${resource.commitHash}/all-files`;
  const displayName = `Commit ${resource.commitHash.substring(0, 7)} (${diffs.length} files)`;

  return useBufferStore
    .getState()
    .actions.openBuffer(virtualPath, displayName, "", false, undefined, true, true, multiDiff);
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
      return openCommitDiffBuffer(resource);

    case "git-worktree":
      useRepositoryStore.getState().actions.selectRepository(resource.path);
      return null;

    case "github-pr":
      return bufferActions.openPRBuffer(resource.number, {
        title: resource.title,
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
