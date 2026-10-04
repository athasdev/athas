import { commands } from "@/bindings/commands";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { toast } from "sonner";
import { connectionStore } from "../stores/remote-connection.store";
import type { RemoteConnection } from "../types/remote.types";
import { getFriendlyRemoteError } from "../utils/remote-errors";
import { withRemoteHostTrust } from "./remote-host-trust";
import { establishRemoteConnection } from "./remote-connection-client";

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

export async function saveAndConnectRemoteConnection(connection: RemoteConnection): Promise<void> {
  try {
    await connectionStore.saveConnection(connection);
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
