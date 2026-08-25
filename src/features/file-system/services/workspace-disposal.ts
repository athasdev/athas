import { invoke } from "@tauri-apps/api/core";
import { connectionStore } from "@/features/remote/stores/remote-connection.store";
import { parseRemotePath } from "@/features/remote/utils/remote-path";
import { closeTerminalConnection } from "@/features/terminal/services/terminal-connection-lifecycle";
import type { Terminal } from "@/features/terminal/types/terminal.types";
import { cancelFileWatcherRefreshes } from "./file-watcher-refresh-scheduler";

type DisposableTerminalConnection = Pick<Terminal, "connectionId" | "remoteConnectionId">;

interface DisposeWorkspaceResourcesOptions {
  workspaceId: string;
  path: string;
  terminalConnections: Iterable<DisposableTerminalConnection>;
}

export async function disposeWorkspaceResources({
  workspaceId,
  path,
  terminalConnections,
}: DisposeWorkspaceResourcesOptions) {
  cancelFileWatcherRefreshes(workspaceId);

  await Promise.all(
    [...terminalConnections].map(async (connection) => {
      if (!connection.connectionId) {
        return;
      }

      await closeTerminalConnection(connection).catch((error) => {
        console.error("Failed to close terminal session:", error);
      });
    }),
  );

  const remote = parseRemotePath(path);
  if (!remote) {
    return;
  }

  await invoke("ssh_disconnect_only", {
    connectionId: remote.connectionId,
  }).catch((error) => {
    console.error("Failed to disconnect remote workspace:", error);
  });
  await connectionStore.updateConnectionStatus(remote.connectionId, false).catch(() => {});
}
