import { invoke } from "@tauri-apps/api/core";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { buildRemoteRootPath } from "@/features/remote/utils/remote-path";
import { toast } from "@/ui/toast";
import { connectionStore } from "./remote-connection-store";
import type { RemoteConnection } from "../types";
import { getFriendlyRemoteError } from "../utils/remote-errors";

export async function loadRemoteConnections(): Promise<RemoteConnection[]> {
  return connectionStore.getAllConnections();
}

export async function connectRemoteConnection(
  connection: RemoteConnection,
  providedPassword?: string,
): Promise<void> {
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

  const { handleOpenRemoteProject } = useFileSystemStore.getState();
  if (handleOpenRemoteProject) {
    await handleOpenRemoteProject(connection.id, connection.name);
    await useFileSystemStore.getState().restoreSession(buildRemoteRootPath(connection.id));
  }

  toast.success(`Connected to ${connection.name}`);
}

export async function disconnectRemoteConnection(connection: RemoteConnection): Promise<void> {
  await invoke("ssh_disconnect", { connectionId: connection.id });
  await connectionStore.updateConnectionStatus(connection.id, false);
  toast.info(`Disconnected from ${connection.name}`);
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
    await invoke("ssh_connect", {
      connectionId: tempId,
      host: connection.host,
      port: connection.port,
      username: connection.username,
      password: connection.password || null,
      keyPath: connection.keyPath || null,
      useSftp: connection.type === "sftp",
    });
  } catch (error) {
    throw new Error(getFriendlyRemoteError(error));
  } finally {
    await invoke("ssh_disconnect_only", { connectionId: tempId }).catch(() => {});
  }
}
