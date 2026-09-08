import { areProjectTabPathsEqual } from "@/features/window/utils/project-tab-path";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useWorkspaceTabsStore } from "@/features/window/stores/workspace-tabs.store";
import { parseRemotePath } from "@/features/remote/utils/remote-path";
import { connectionStore } from "@/features/remote/stores/remote-connection.store";
import { connectRemoteConnection } from "@/features/remote/services/remote-connection-actions";
import { useBufferStore } from "@/features/editor/stores/buffer.store";

export async function openManagedWorkspace(path: string, showManagement = false): Promise<void> {
  const fs = useFileSystemStore.getState();
  const existing = useWorkspaceTabsStore
    .getState()
    .projectTabs.find((tab) => areProjectTabPathsEqual(tab.path, path));
  const remote = parseRemotePath(path);
  if (existing) {
    if (!(await fs.switchToProject(existing.id))) throw new Error("Could not open workspace.");
  } else if (remote) {
    const connection = await connectionStore.getConnection(remote.connectionId);
    if (!connection)
      throw new Error("The SSH connection is no longer available. Add it in Environments.");
    await connectRemoteConnection(connection);
  } else if (!(await fs.handleOpenFolderByPath(path))) {
    throw new Error("Could not open workspace.");
  }
  if (showManagement) useBufferStore.getState().actions.openContent({ type: "workspaces" });
}
