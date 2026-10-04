import { commands } from "@/bindings/commands";
import { withRemoteHostTrust } from "./remote-host-trust";
import { connectionStore } from "../stores/remote-connection.store";
import type { RemoteConnection } from "../types/remote.types";

export async function establishRemoteConnection(
  connection: RemoteConnection,
  providedPassword?: string,
) {
  await withRemoteHostTrust(connection, () =>
    commands.sshConnect(
      connection.id,
      connection.host,
      connection.port,
      connection.username,
      providedPassword || connection.password || null,
      connection.keyPath || null,
      connection.type === "sftp",
    ),
  );

  await connectionStore.updateConnectionStatus(connection.id, true, new Date().toISOString());
}

export async function ensureRemoteConnectionConnected(connectionId: string) {
  const connection = await connectionStore.getConnection(connectionId);
  if (!connection) {
    throw new Error("Remote connection not found.");
  }

  if (!connection.isConnected) {
    await establishRemoteConnection(connection);
  }

  return connection;
}
