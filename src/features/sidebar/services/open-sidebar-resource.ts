import { type OpenContentOptions, useBufferStore } from "@/features/editor/stores/buffer.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { getFileDiff } from "@/features/git/api/git-diff-api";
import { openGitWorktreeWorkspace } from "@/features/git/services/git-worktree-open";
import { openCommitDiffBuffer } from "@/features/git/services/open-commit-diff-buffer";
import { createSingleFileWorkingTreeDiff } from "@/features/git/services/working-tree-multi-diff";
import { getFolderName } from "@/utils/path-helpers";
import type { SidebarDragResource } from "./sidebar-resource-drag";
import { getActiveBufferId } from "@/features/panes/stores/pane-selectors";

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
  openOptions?: OpenContentOptions,
): Promise<string | null> => {
  const actualFilePath = normalizeGitFilePath(resource.filePath, resource.staged);

  if (resource.status === "untracked" && !resource.staged) {
    await useFileSystemStore
      .getState()
      .handleFileOpen(`${resource.repoPath}/${actualFilePath}`, false, openOptions);
    return getActiveBufferId();
  }

  const diff = await getFileDiff(resource.repoPath, actualFilePath, resource.staged);
  if (!diff || (diff.lines.length === 0 && diff.is_image !== true)) {
    await useFileSystemStore
      .getState()
      .handleFileOpen(`${resource.repoPath}/${actualFilePath}`, false, openOptions);
    return getActiveBufferId();
  }

  const fileKey = `${resource.staged ? "staged" : "unstaged"}:${actualFilePath}`;
  const multiDiff = createSingleFileWorkingTreeDiff({
    repoPath: resource.repoPath,
    fileKey,
    diff,
  });

  const encodedPath = encodeURIComponent(actualFilePath);
  const virtualPath = `diff://working-tree/${resource.staged ? "staged" : "unstaged"}/${encodedPath}`;
  const displayName = `${getFolderName(actualFilePath)}.diff`;

  return useBufferStore
    .getState()
    .actions.openContent(
      { type: "diff", path: virtualPath, name: displayName, content: "", diffData: multiDiff },
      openOptions,
    );
};

const openSidebarCommitDiffBuffer = async (
  resource: Extract<SidebarDragResource, { type: "git-commit" }>,
  openOptions?: OpenContentOptions,
): Promise<string | null> => {
  return openCommitDiffBuffer(
    {
      repoPath: resource.repoPath,
      commitHash: resource.commitHash,
      message: resource.message,
      author: resource.author,
      date: resource.date,
    },
    openOptions,
  );
};

/** Opens a dragged sidebar resource, in `openOptions.paneId` when given. */
export const openSidebarResourceBuffer = async (
  resource: SidebarDragResource,
  openOptions?: OpenContentOptions,
): Promise<string | null> => {
  const bufferActions = useBufferStore.getState().actions;

  switch (resource.type) {
    case "file":
      if (resource.isDir) {
        return null;
      }
      await useFileSystemStore.getState().handleFileOpen(resource.path, false, openOptions);
      return getActiveBufferId();

    case "git-file-diff":
      return openWorkingTreeDiffBuffer(resource, openOptions);

    case "git-commit":
      return openSidebarCommitDiffBuffer(resource, openOptions);

    case "git-worktree":
      await openGitWorktreeWorkspace(resource.path);
      return null;

    case "github-pr":
      return bufferActions.openPRBuffer(
        resource.number,
        {
          title: resource.title,
          repoPath: resource.repoPath,
          authorAvatarUrl: resource.authorAvatarUrl,
        },
        openOptions,
      );

    case "github-issue":
      return bufferActions.openGitHubIssueBuffer(
        {
          issueNumber: resource.number,
          repoPath: resource.repoPath,
          title: resource.title,
          authorAvatarUrl: resource.authorAvatarUrl,
          url: resource.url,
        },
        openOptions,
      );

    case "github-delivery":
      return bufferActions.openContent(
        {
          type: "githubDelivery",
          kind: resource.kind,
          repoPath: resource.repoPath,
          resourceId: resource.resourceId,
          name: resource.name,
        },
        openOptions,
      );

    case "github-action":
      return bufferActions.openGitHubActionBuffer(
        {
          runId: resource.runId,
          repoPath: resource.repoPath,
          title: resource.title,
          url: resource.url,
        },
        openOptions,
      );
  }
};
