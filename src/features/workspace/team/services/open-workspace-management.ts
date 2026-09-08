import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useWorkspaceManagementStore } from "../stores/workspace-management.store";

export function openWorkspaceManagement() {
  const root = useFileSystemStore.getState().rootFolderPath;
  if (root) useWorkspaceManagementStore.getState().actions.register(root);
  return useBufferStore.getState().actions.openContent({ type: "workspaces" });
}
