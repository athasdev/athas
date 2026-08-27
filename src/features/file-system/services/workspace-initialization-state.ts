import type { FileEntry } from "../types/app.types";

export interface InitializedWorkspaceState {
  path: string;
  name: string;
  files: FileEntry[];
}

interface WorkspaceInitializationStateActions {
  addProjectTab: (path: string, name: string) => void;
  getActiveProjectTabId: () => string | undefined;
  expandRoot: (path: string) => void;
  setProjectMetadata: (path: string, name: string, activeProjectId: string | undefined) => void;
  restoreUiState: (path: string) => void;
  commitFileSystemState: (workspace: InitializedWorkspaceState) => void;
}

export function applyWorkspaceInitializationState(
  workspace: InitializedWorkspaceState,
  actions: WorkspaceInitializationStateActions,
) {
  actions.addProjectTab(workspace.path, workspace.name);
  const activeProjectId = actions.getActiveProjectTabId();

  actions.expandRoot(workspace.path);
  actions.setProjectMetadata(workspace.path, workspace.name, activeProjectId);
  actions.restoreUiState(workspace.path);
  actions.commitFileSystemState(workspace);

  return activeProjectId;
}
