import { commands } from "@/bindings/commands";

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

  if (remoteConnectionId) {
    await commands.closeRemoteTerminal(connectionId);
    return;
  }

  await commands.closeTerminal(connectionId);
}
