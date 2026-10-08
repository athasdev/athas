import type { McpServerSetting, McpTransport } from "../types/ai-settings.types";

const MCP_TRANSPORTS: readonly McpTransport[] = ["stdio", "http", "sse"];
const MAX_MCP_SERVERS = 100;
/** Server ids key the stored secrets, so they are limited to what the backend accepts. */
const SERVER_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMcpTransport(value: unknown): value is McpTransport {
  return typeof value === "string" && (MCP_TRANSPORTS as readonly string[]).includes(value);
}

/** Keeps well-formed servers from persisted or imported settings and drops the rest. */
export function normalizeMcpServers(value: unknown): McpServerSetting[] {
  if (!Array.isArray(value)) return [];

  const seenIds = new Set<string>();
  const servers: McpServerSetting[] = [];

  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const { id, name, transport } = entry;
    if (typeof id !== "string" || !SERVER_ID_PATTERN.test(id) || seenIds.has(id)) continue;
    if (typeof name !== "string" || !name.trim()) continue;
    if (!isMcpTransport(transport)) continue;

    seenIds.add(id);
    servers.push({
      id,
      name: name.trim(),
      enabled: entry.enabled !== false,
      transport,
      command: typeof entry.command === "string" ? entry.command : "",
      args: Array.isArray(entry.args)
        ? entry.args.filter((arg): arg is string => typeof arg === "string")
        : [],
      url: typeof entry.url === "string" ? entry.url : "",
    });
    if (servers.length >= MAX_MCP_SERVERS) break;
  }

  return servers;
}
