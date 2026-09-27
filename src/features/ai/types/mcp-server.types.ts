/** How an agent reaches an MCP server. Every ACP agent supports stdio. */
export type McpTransport = "stdio" | "http" | "sse";

/**
 * An MCP server as stored in settings. Secret values (environment variables and headers) are
 * kept in secure storage under the server id, never here.
 */
export interface McpServerSetting {
  id: string;
  name: string;
  enabled: boolean;
  transport: McpTransport;
  /** Stdio only. */
  command: string;
  /** Stdio only. */
  args: string[];
  /** HTTP and SSE only. */
  url: string;
}

export interface McpNameValue {
  name: string;
  value: string;
}

/** The part of a server kept in secure storage. */
export interface McpServerSecrets {
  env: McpNameValue[];
  headers: McpNameValue[];
}

/** A server being added or edited: settings fields plus secrets, args as one per line. */
export interface McpServerDraft {
  id: string | null;
  name: string;
  enabled: boolean;
  transport: McpTransport;
  command: string;
  argsText: string;
  url: string;
  env: McpNameValue[];
  headers: McpNameValue[];
}

export type McpServerDraftField = "name" | "command" | "url" | "env" | "headers";

export type McpServerDraftErrors = Partial<Record<McpServerDraftField, string>>;

/** A configured server an agent did not take because it does not support the transport. */
export interface AcpSkippedMcpServer {
  name: string;
  transport: McpTransport;
}
