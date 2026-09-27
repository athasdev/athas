const STORAGE_KEY = "athas.intelligence.mcp-tool-allowlist.v1";
const MAX_TOOLS_PER_SERVER = 200;

/** Tool names the user always allows, keyed by MCP server id. */
type Allowlist = Record<string, string[]>;

function storage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function readAllowlist(): Allowlist {
  try {
    const parsed = JSON.parse(storage()?.getItem(STORAGE_KEY) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: Allowlist = {};
    for (const [serverId, tools] of Object.entries(parsed)) {
      if (Array.isArray(tools))
        result[serverId] = tools.filter((tool): tool is string => typeof tool === "string");
    }
    return result;
  } catch {
    return {};
  }
}

function writeAllowlist(allowlist: Allowlist) {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(allowlist));
  } catch {
    // Storage is full or unavailable; the call still runs this once.
  }
}

export function isMcpToolAllowed(serverId: string, tool: string): boolean {
  return readAllowlist()[serverId]?.includes(tool) ?? false;
}

/** Remembers that `tool` on `serverId` may run without asking. */
export function allowMcpTool(serverId: string, tool: string) {
  const allowlist = readAllowlist();
  const tools = allowlist[serverId] ?? [];
  if (tools.includes(tool)) return;
  allowlist[serverId] = [...tools, tool].slice(-MAX_TOOLS_PER_SERVER);
  writeAllowlist(allowlist);
}

/** Every always-allowed MCP tool, by server id. */
export function getAllowedMcpTools(): Allowlist {
  return readAllowlist();
}

export function removeAllowedMcpTool(serverId: string, tool: string) {
  const allowlist = readAllowlist();
  const tools = (allowlist[serverId] ?? []).filter((entry) => entry !== tool);
  if (tools.length) allowlist[serverId] = tools;
  else delete allowlist[serverId];
  writeAllowlist(allowlist);
}
