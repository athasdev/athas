import { invoke } from "@tauri-apps/api/core";
import type { McpServerSecrets } from "@/features/ai/types/mcp-server.types";

/** Environment variables and headers of an MCP server, read from secure storage. */
export async function getMcpServerSecrets(serverId: string): Promise<McpServerSecrets> {
  const secrets = await invoke<Partial<McpServerSecrets> | null>("get_mcp_server_secrets", {
    serverId,
  });
  return { env: secrets?.env ?? [], headers: secrets?.headers ?? [] };
}

/** Saves a server's secrets; empty secrets clear the stored entry. */
export async function storeMcpServerSecrets(
  serverId: string,
  secrets: McpServerSecrets,
): Promise<void> {
  await invoke("store_mcp_server_secrets", { serverId, secrets });
}

export async function removeMcpServerSecrets(serverId: string): Promise<void> {
  await invoke("remove_mcp_server_secrets", { serverId });
}
