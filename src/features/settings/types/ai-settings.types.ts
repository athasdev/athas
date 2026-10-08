/**
 * Shapes of the AI settings as they are persisted. AI owns their behaviour; settings owns the
 * stored format and its normalization.
 */

export interface AIChatSkill {
  id: string;
  title: string;
  description?: string;
  content: string;
  author?: string;
  license?: string;
  sourceUrl?: string;
  source?: "local" | "marketplace";
  sourceId?: string;
  version?: string;
  tags?: string[];
  localOverride?: boolean;
  upstreamTitle?: string;
  upstreamDescription?: string;
  upstreamContent?: string;
  upstreamUpdatedAt?: string;
  createdAt: string;
  updatedAt: string;
}

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
