import { invoke } from "@tauri-apps/api/core";
import { connectionStore } from "../stores/remote-connection.store";
import type { RemoteConnection } from "../types/remote.types";

export async function establishRemoteConnection(
  connection: RemoteConnection,
  providedPassword?: string,
) {
  await invoke("ssh_connect", {
    connectionId: connection.id,
    host: connection.host,
    port: connection.port,
    username: connection.username,
    password: providedPassword || connection.password || null,
    keyPath: connection.keyPath || null,
    useSftp: connection.type === "sftp",
  });

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
