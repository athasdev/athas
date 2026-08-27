import { invoke } from "@tauri-apps/api/core";

interface TerminalConnectionReference {
  connectionId?: string;
  remoteConnectionId?: string;
}

export async function closeTerminalConnection({
  connectionId,
  remoteConnectionId,
}: TerminalConnectionReference) {
  if (!connectionId) {
    return;
  }

  await invoke(remoteConnectionId ? "close_remote_terminal" : "close_terminal", {
    id: connectionId,
  });
}
