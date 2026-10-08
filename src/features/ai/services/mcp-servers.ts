import type {
  AcpSkippedMcpServer,
  McpNameValue,
  McpServerDraft,
  McpServerDraftErrors,
  McpServerSecrets,
  McpServerSetting,
  McpTransport,
} from "@/features/ai/types/mcp-server.types";

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

export const MCP_TRANSPORT_LABELS: Record<McpTransport, string> = {
  stdio: "Stdio",
  http: "HTTP",
  sse: "SSE",
};

export function createMcpServerDraft(
  server?: McpServerSetting,
  secrets?: McpServerSecrets,
): McpServerDraft {
  return {
    id: server?.id ?? null,
    name: server?.name ?? "",
    enabled: server?.enabled ?? true,
    transport: server?.transport ?? "stdio",
    command: server?.command ?? "",
    argsText: server?.args.join("\n") ?? "",
    url: server?.url ?? "",
    env: secrets?.env.map((entry) => ({ ...entry })) ?? [],
    headers: secrets?.headers.map((entry) => ({ ...entry })) ?? [],
  };
}

function parseArgs(argsText: string): string[] {
  return argsText
    .split(/\r?\n/)
    .map((arg) => arg.trim())
    .filter(Boolean);
}

function withoutBlankRows(values: McpNameValue[]): McpNameValue[] {
  return values
    .map((entry) => ({ name: entry.name.trim(), value: entry.value }))
    .filter((entry) => entry.name || entry.value);
}

function validateNameValues(
  values: McpNameValue[],
  pattern: RegExp,
  noun: string,
  caseInsensitive: boolean,
): string | undefined {
  const seen = new Set<string>();
  for (const entry of withoutBlankRows(values)) {
    if (!entry.name) return `Every ${noun} with a value needs a name`;
    if (!pattern.test(entry.name)) return `"${entry.name}" is not a valid ${noun} name`;
    const key = caseInsensitive ? entry.name.toLowerCase() : entry.name;
    if (seen.has(key)) return `${entry.name} is set more than once`;
    seen.add(key);
  }
  return undefined;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Checks a draft before it is saved. Names must be unique because agents identify servers by
 * name; only the fields the chosen transport uses are checked.
 */
export function validateMcpServerDraft(
  draft: McpServerDraft,
  servers: readonly McpServerSetting[],
): McpServerDraftErrors {
  const errors: McpServerDraftErrors = {};
  const name = draft.name.trim();

  if (!name) {
    errors.name = "Enter a name";
  } else if (
    servers.some(
      (server) => server.id !== draft.id && server.name.toLowerCase() === name.toLowerCase(),
    )
  ) {
    errors.name = "Another server already uses this name";
  }

  if (draft.transport === "stdio") {
    if (!draft.command.trim()) errors.command = "Enter the command that starts the server";
    const envError = validateNameValues(draft.env, ENV_NAME_PATTERN, "variable", false);
    if (envError) errors.env = envError;
  } else {
    const url = draft.url.trim();
    if (!url) errors.url = "Enter the server URL";
    else if (!isHttpUrl(url)) errors.url = "Use an http:// or https:// URL";
    const headerError = validateNameValues(draft.headers, HEADER_NAME_PATTERN, "header", true);
    if (headerError) errors.headers = headerError;
  }

  return errors;
}

export function hasMcpServerDraftErrors(errors: McpServerDraftErrors): boolean {
  return Object.values(errors).some(Boolean);
}

/**
 * Splits a valid draft into what goes to settings and what goes to secure storage. Fields the
 * transport does not use are cleared so a server never carries stale secrets.
 */
export function splitMcpServerDraft(
  draft: McpServerDraft,
  id: string,
): { server: McpServerSetting; secrets: McpServerSecrets } {
  const isStdio = draft.transport === "stdio";
  return {
    server: {
      id,
      name: draft.name.trim(),
      enabled: draft.enabled,
      transport: draft.transport,
      command: isStdio ? draft.command.trim() : "",
      args: isStdio ? parseArgs(draft.argsText) : [],
      url: isStdio ? "" : draft.url.trim(),
    },
    secrets: {
      env: isStdio ? withoutBlankRows(draft.env) : [],
      headers: isStdio ? [] : withoutBlankRows(draft.headers),
    },
  };
}

/** One line for the settings list: the command line or the URL. */
export function describeMcpServer(server: McpServerSetting): string {
  if (server.transport === "stdio") return [server.command, ...server.args].join(" ");
  return server.url;
}

/** The notice shown when an agent could not take some configured servers. */
export function formatSkippedMcpServersNotice(
  agentName: string,
  skipped: readonly AcpSkippedMcpServer[],
): string | null {
  if (skipped.length === 0) return null;
  const list = skipped
    .map((server) => `${server.name} (${MCP_TRANSPORT_LABELS[server.transport]})`)
    .join(", ");
  return `${agentName} cannot use these MCP servers, so they were not passed to it: ${list}.`;
}
