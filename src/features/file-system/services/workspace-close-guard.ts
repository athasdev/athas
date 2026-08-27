import { getDirtyEditorBuffers } from "@/features/editor/utils/editor-buffer-selectors";
import type { PaneContent } from "@/features/panes/types/pane-content.types";

interface WorkspaceCloseGuardOptions {
  workspaceId: string;
  getActiveWorkspaceId: () => string;
  getBuffers: () => PaneContent[];
  switchToWorkspace: (workspaceId: string) => Promise<boolean>;
  confirmUnsavedBuffers: (buffers: PaneContent[]) => Promise<boolean>;
}

export async function prepareWorkspaceClose({
  workspaceId,
  getActiveWorkspaceId,
  getBuffers,
  switchToWorkspace,
  confirmUnsavedBuffers,
}: WorkspaceCloseGuardOptions) {
  if (getDirtyEditorBuffers(getBuffers()).length === 0) {
    return true;
  }

  if (getActiveWorkspaceId() !== workspaceId && !(await switchToWorkspace(workspaceId))) {
    return false;
  }

  return await confirmUnsavedBuffers(getBuffers());
}
