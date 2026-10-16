import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { activateBufferInPaneAndSync } from "@/features/panes/services/pane-activation";
import { selectActivePane } from "@/features/panes/stores/pane-selectors";
import { usePaneStore } from "@/features/panes/stores/pane.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { normalizeProjectTabPath } from "@/features/workspace/services/project-tab-path";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { useWorkspaceTabsStore } from "@/features/workspace/stores/workspace-tabs.store";
import { useDockLayoutStore } from "../stores/dock-layout.store";
import { getProjectToolPaneId } from "./dock-pane-registry";

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
 * The project's own view, without a session: its open files in the centre and its tools in the
 * dock, opening on Files.
 */
export async function showProjectView(projectId: string) {
  if (!(await activateProject(projectId))) return;
  const rootFolderPath = useProjectStore.getState().rootFolderPath;
  if (!rootFolderPath) return;
  const projectKey = normalizeProjectTabPath(rootFolderPath);
  const dock = useDockLayoutStore.getState().actions;
  dock.setStickySession(projectKey, null);

  const pane = selectActivePane(usePaneStore.getState());
  const buffers = useBufferStore.getState().buffers;
  const file = [...(pane?.bufferIds ?? [])]
    .reverse()
    .find((bufferId) => buffers.find((buffer) => buffer.id === bufferId)?.type !== "agent");
  if (pane && file) activateBufferInPaneAndSync(pane.id, file);

  dock.open({ kind: "project", id: projectKey }, getProjectToolPaneId("files"));
}
