import { commands } from "@/bindings/commands";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { toast } from "sonner";
import { connectionStore } from "@/features/remote/stores/remote-connection.store";
import type { RemoteConnection } from "@/features/remote/types/remote.types";
import { getFriendlyRemoteError } from "@/features/remote/services/remote-errors";
import { withRemoteHostTrust } from "@/features/remote/services/remote-host-trust";
import { establishRemoteConnection } from "@/features/remote/services/remote-connection-client";

export async function loadRemoteConnections(): Promise<RemoteConnection[]> {
  return connectionStore.getAllConnections();
}

export async function connectRemoteConnection(
  connection: RemoteConnection,
  providedPassword?: string,
): Promise<void> {
  await establishRemoteConnection(connection, providedPassword);

  const { handleOpenRemoteProject } = useFileSystemStore.getState();
  if (handleOpenRemoteProject) {
    const opened = await handleOpenRemoteProject(connection.id, connection.name);
    if (!opened) {
      throw new Error("Failed to open remote workspace.");
    }
  }

  toast.success(`Connected to ${connection.name}`);
}

async function syncRemoteProjectTabNames(connectionId: string, connectionName: string) {
  try {
    const { useWorkspaceTabsStore } = await import("../stores/workspace-tabs.store");
    useWorkspaceTabsStore.getState().actions.renameRemoteProjectTabs(connectionId, connectionName);
  } catch (error) {
    console.warn("Failed to sync remote workspace tab name:", error);
  }
}

export async function saveAndConnectRemoteConnection(connection: RemoteConnection): Promise<void> {
  try {
    await connectionStore.saveConnection(connection);
    await syncRemoteProjectTabNames(connection.id, connection.name);
    await connectRemoteConnection(connection);
  } catch (error) {
    await Promise.allSettled([
      commands.sshDisconnectOnly(connection.id),
      connectionStore.deleteConnection(connection.id),
    ]);
    throw error;
  }
}

export async function testRemoteConnection(connection: {
  host: string;
  port: number;
  username: string;
  password?: string;
  keyPath?: string;
  type: "ssh" | "sftp";
}): Promise<void> {
  const tempId = `test-${Date.now()}`;

  try {
    await withRemoteHostTrust(connection, () =>
      commands.sshConnect(
        tempId,
        connection.host,
        connection.port,
        connection.username,
        connection.password || null,
        connection.keyPath || null,
        connection.type === "sftp",
      ),
    );
  } catch (error) {
    throw new Error(getFriendlyRemoteError(error));
  } finally {
    await commands.sshDisconnectOnly(tempId).catch(() => {});
  }
}
