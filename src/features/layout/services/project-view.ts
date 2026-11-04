import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { activateBufferInPaneAndSync } from "@/features/panes/services/pane-activation";
import { selectActivePane } from "@/features/panes/stores/pane-selectors";
import { usePaneStore } from "@/features/panes/stores/pane.store";
import { showProjectTabSet } from "@/features/panes/services/tab-set-navigation";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { useWorkspaceTabsStore } from "@/features/workspace/stores/workspace-tabs.store";
import { showProjectTool } from "./project-tools";

/** Makes `projectId` the active project; resolves whether it is. Running sessions keep running. */
export async function activateProject(projectId: string): Promise<boolean> {
  if (workspaceRuntimeRegistry.getActiveWorkspaceId() === projectId) return true;
  const isOpen = useWorkspaceTabsStore
    .getState()
    .projectTabs.some((project) => project.id === projectId);
  if (!isOpen) return false;
  return useFileSystemStore.getState().switchToProject(projectId);
}

/**
 * The project's own view, without a session: the project's tab set in the centre (the files it
 * keeps open apart from any session's) and its files in the sidebar.
 */
export async function showProjectView(projectId: string) {
  if (!(await activateProject(projectId))) return;
  if (!useProjectStore.getState().rootFolderPath) return;
  showProjectTabSet();

  // A tab set saved before sessions had their own may still lead with a session's tab.
  const pane = selectActivePane(usePaneStore.getState());
  const buffers = useBufferStore.getState().buffers;
  const activeBuffer = buffers.find((buffer) => buffer.id === pane?.activeBufferId);
  const file = [...(pane?.bufferIds ?? [])]
    .reverse()
    .find((bufferId) => buffers.find((buffer) => buffer.id === bufferId)?.type !== "agent");
  if (pane && file && activeBuffer?.type === "agent") activateBufferInPaneAndSync(pane.id, file);

  showProjectTool("files", { focus: false });
}
