import { createMcpServerDraft } from "@/features/ai/services/mcp-servers";
import type { McpNameValue, McpServerDraft } from "@/features/ai/types/mcp-server.types";

/** Longest `config` value accepted, so a link cannot hand the editor megabytes of JSON. */
const MAX_CONFIG_LENGTH = 16 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Decodes standard or URL-safe base64; `+` read back as a space from an unescaped query is restored. */
function decodeBase64Json(value: string): unknown {
  const normalized = value.replace(/[ -]/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function toNameValues(value: unknown): McpNameValue[] {
  if (!isRecord(value)) return [];
  return Object.entries(value)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([name, entryValue]) => ({ name, value: entryValue }));
}

/**
 * Reads an "Add to Athas" link, `athas://mcp/install?name=<name>&config=<base64 JSON>`, into a
 * draft for the MCP server dialog. The config uses the same shape as Cursor install links and
 * `mcp.json` entries: `{ command, args, env }` for local servers or `{ url, headers, type }` for
 * remote ones. Returns `null` when the link is malformed. The draft is never saved here; the user
 * reviews it in the dialog first.
 */
export function parseMcpInstallLink(url: URL): McpServerDraft | null {
  const name = url.searchParams.get("name")?.trim();
  const encoded = url.searchParams.get("config");
  if (!name || !encoded || encoded.length > MAX_CONFIG_LENGTH) return null;

  let config: unknown;
  try {
    config = decodeBase64Json(encoded);
  } catch {
    return null;
  }
  if (!isRecord(config)) return null;

  const draft = createMcpServerDraft();
  draft.name = name;

  if (typeof config.command === "string" && config.command.trim()) {
    const args = Array.isArray(config.args)
      ? config.args.filter((arg): arg is string => typeof arg === "string")
      : [];
    return {
      ...draft,
      transport: "stdio",
      command: config.command.trim(),
      argsText: args.join("\n"),
      env: toNameValues(config.env),
    };
  }

  if (typeof config.url === "string") {
    let remote: URL;
    try {
      remote = new URL(config.url);
    } catch {
      return null;
    }
    if (remote.protocol !== "https:" && remote.protocol !== "http:") return null;
    return {
      ...draft,
      transport: config.type === "sse" ? "sse" : "http",
      url: remote.toString(),
      headers: toNameValues(config.headers),
    };
  }

  return null;
}
