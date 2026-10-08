import { useUIState } from "@/features/layout/stores/ui-state.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useWorkspaceManagementStore } from "../stores/workspace-management.store";
import { useProjectStore } from "@/features/workspace/stores/project.store";

export function openWorkspaceManagement() {
  const root = useProjectStore.getState().rootFolderPath;
  if (root) useWorkspaceManagementStore.getState().actions.register(root);
  const ui = useUIState.getState();
  ui.setActiveView("workspaces");
  ui.setIsSidebarVisible(true);
  return useBufferStore.getState().actions.openContent({ type: "workspaces" });
}
