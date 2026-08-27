interface WorkspaceResetHandlers {
  resetFileSystemState: () => void;
  collapseFileTree: () => void;
  resetProjectMetadata: () => void;
  closeBuffer: (bufferId: string) => void;
  stopFileWatcher: () => Promise<void>;
  resetGitState: () => void;
  clearGitDiffCache: () => void;
  clearGitBlame: () => void;
}

interface ResetWorkspaceResourcesOptions extends WorkspaceResetHandlers {
  bufferIds: string[];
}

export async function resetWorkspaceResources({
  bufferIds,
  resetFileSystemState,
  collapseFileTree,
  resetProjectMetadata,
  closeBuffer,
  stopFileWatcher,
  resetGitState,
  clearGitDiffCache,
  clearGitBlame,
}: ResetWorkspaceResourcesOptions) {
  resetFileSystemState();
  collapseFileTree();
  resetProjectMetadata();

  bufferIds.forEach(closeBuffer);

  await stopFileWatcher();
  resetGitState();
  clearGitDiffCache();
  clearGitBlame();
}
