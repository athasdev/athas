import { showProjectTool } from "@/features/layout/services/project-tools";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useWorkspaceManagementStore } from "../stores/workspace-management.store";
import { useProjectStore } from "@/features/workspace/stores/project.store";

export function openWorkspaceManagement() {
  const root = useProjectStore.getState().rootFolderPath;
  if (root) useWorkspaceManagementStore.getState().actions.register(root);
  showProjectTool("workspaces");
  return useBufferStore.getState().actions.openContent({ type: "workspaces" });
}
