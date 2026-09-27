const PREFIX = "mcp__";
/** Providers such as OpenAI reject tool names longer than this. */
const MAX_TOOL_NAME_LENGTH = 64;

function slug(value: string) {
  return value
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * The name a model sees for `tool` on `server`: `mcp__<server>__<tool>`, the convention ACP
 * agents use too. Server names never contain `__`, so the name splits back unambiguously.
 */
export function toMcpToolName(server: string, tool: string): string {
  const serverSlug = slug(server).replace(/_+/g, "_") || "server";
  const toolSlug = slug(tool) || "tool";
  return `${PREFIX}${serverSlug}__${toolSlug}`.slice(0, MAX_TOOL_NAME_LENGTH);
}

/** Splits an `mcp__<server>__<tool>` name, or returns null for any other tool. */
export function parseMcpToolName(name: string): { server: string; tool: string } | null {
  if (!name.startsWith(PREFIX)) return null;
  const rest = name.slice(PREFIX.length);
  const separator = rest.indexOf("__");
  if (separator <= 0 || separator === rest.length - 2) return null;
  return { server: rest.slice(0, separator), tool: rest.slice(separator + 2) };
}
