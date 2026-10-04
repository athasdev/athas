import { commands } from "@/bindings/commands";
import type { McpServerSecrets } from "@/features/ai/types/mcp-server.types";

/** Environment variables and headers of an MCP server, read from secure storage. */
export async function getMcpServerSecrets(serverId: string): Promise<McpServerSecrets> {
  const secrets = await commands.getMcpServerSecrets(serverId);
  return { env: secrets.env ?? [], headers: secrets.headers ?? [] };
}

/** Saves a server's secrets; empty secrets clear the stored entry. */
export async function storeMcpServerSecrets(
  serverId: string,
  secrets: McpServerSecrets,
): Promise<void> {
  await commands.storeMcpServerSecrets(serverId, secrets);
}

export async function removeMcpServerSecrets(serverId: string): Promise<void> {
  await commands.removeMcpServerSecrets(serverId);
}
