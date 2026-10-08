import { listen } from "@tauri-apps/api/event";

interface SshConnectionStatusEvent {
  connectionId: string;
  connected: boolean;
}

export function listenForSshConnectionStatus(
  handler: (status: SshConnectionStatusEvent) => void | Promise<void>,
) {
  return listen<SshConnectionStatusEvent>("ssh_connection_status", (event) =>
    handler(event.payload),
  );
}
