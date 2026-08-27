export type LocalWorkspaceOpenResult = "opened" | "cancelled" | "failed";

export interface LocalWorkspaceOpenOptions<TWorkspace> {
  replacingCurrentWorkspace: boolean;
  currentBufferIds: string[];
  prepareTransition: () => Promise<boolean>;
  persistCurrentSession: () => void;
  closeCurrentBuffers: (bufferIds: string[]) => void;
  persistCurrentUiState: () => void;
  setLoading: (isLoading: boolean) => void;
  loadWorkspace: () => Promise<TWorkspace>;
  applyWorkspace: (workspace: TWorkspace) => void;
  restoreSession: () => Promise<void>;
  startBackgroundInitialization: () => void;
  onOpenError: (error: unknown) => void;
  onRestoreError: (error: unknown) => void;
}

export async function openLocalWorkspaceTransaction<TWorkspace>(
  options: LocalWorkspaceOpenOptions<TWorkspace>,
): Promise<LocalWorkspaceOpenResult> {
  try {
    if (options.replacingCurrentWorkspace) {
      if (!(await options.prepareTransition())) {
        return "cancelled";
      }

      options.persistCurrentSession();
      if (options.currentBufferIds.length > 0) {
        options.closeCurrentBuffers(options.currentBufferIds);
      }
    } else {
      options.persistCurrentUiState();
    }

    options.setLoading(true);
    const workspace = await options.loadWorkspace();
    options.applyWorkspace(workspace);
  } catch (error) {
    options.setLoading(false);
    options.onOpenError(error);
    return "failed";
  }

  try {
    await options.restoreSession();
  } catch (error) {
    options.onRestoreError(error);
  }

  options.startBackgroundInitialization();
  return "opened";
}
