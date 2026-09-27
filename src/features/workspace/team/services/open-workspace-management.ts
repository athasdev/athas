import { useUIState } from "@/features/window/stores/ui-state.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useWorkspaceManagementStore } from "../stores/workspace-management.store";

export function openWorkspaceManagement() {
  const root = useFileSystemStore.getState().rootFolderPath;
  if (root) useWorkspaceManagementStore.getState().actions.register(root);
  const ui = useUIState.getState();
  ui.setActiveView("workspaces");
  ui.setIsSidebarVisible(true);
  return useBufferStore.getState().actions.openContent({ type: "workspaces" });
}
