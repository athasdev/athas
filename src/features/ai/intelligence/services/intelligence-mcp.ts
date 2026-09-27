import { jsonSchema, tool, type ToolSet } from "ai";
import type { McpServerSetting } from "@/features/ai/types/mcp-server.types";
import { toMcpToolName } from "@/features/ai/lib/mcp-tool-name";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { McpClient } from "../lib/intelligence-mcp-client";
import type { McpToolCallOutput, McpTransport } from "../types/intelligence-mcp.types";
import { createMcpTransport } from "./intelligence-mcp-transports";

const CONNECT_TIMEOUT_MS = 20_000;
const LIST_TIMEOUT_MS = 15_000;
const CALL_TIMEOUT_MS = 120_000;
/** Tools across all servers; more would crowd out the model's own tools. */
const MAX_MCP_TOOLS = 128;

/** One MCP tool call the user is asked to approve. */
export interface McpToolCallRequest {
  serverId: string;
  serverName: string;
  /** The tool's name on its server. */
  tool: string;
  /** The namespaced name the model called. */
  name: string;
  input: unknown;
}

export interface McpToolContext {
  signal: AbortSignal;
  /** Plan mode: only tools that declare themselves read-only are offered. */
  readOnly: boolean;
  /** Resolves whether the call may run; every MCP call can have side effects. */
  authorize: (request: McpToolCallRequest) => Promise<boolean>;
  /** Runs a call so the transcript shows it. */
  track: (
    name: string,
    input: unknown,
    toolCallId: string,
    execute: () => Promise<McpToolCallOutput | { executed: false; reason: string }>,
  ) => Promise<unknown>;
  /** Replaces the transport, for tests. */
  createTransport?: (server: McpServerSetting, cwd?: string) => McpTransport;
  /** Replaces the configured servers, for tests. */
  servers?: McpServerSetting[];
}

export interface ExtraTools {
  tools: ToolSet;
  /** Servers that could not be reached, said once to the user. */
  notices: string[];
  /** Stops every server started for this run. */
  close: () => Promise<void>;
}

function usableServers(servers: McpServerSetting[]) {
  return servers.filter(
    (server) =>
      server.enabled &&
      server.name.trim() &&
      (server.transport === "stdio" ? server.command.trim() : server.url.trim()),
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Connects the enabled MCP servers and offers their tools to the built-in agent as
 * `mcp__<server>__<tool>`. Servers that fail to start are reported and left out.
 */
export async function getExtraTools(
  root: string | undefined,
  context: McpToolContext,
): Promise<ExtraTools> {
  const servers = usableServers(context.servers ?? useSettingsStore.getState().settings.mcpServers);
  const clients: McpClient[] = [];
  const close = async () => {
    await Promise.all(clients.map((client) => client.close()));
  };
  if (servers.length === 0) return { tools: {}, notices: [], close };

  const createTransport = context.createTransport ?? createMcpTransport;
  const connected = await Promise.all(
    servers.map(async (server) => {
      const client = new McpClient(server.name, createTransport(server, root));
      clients.push(client);
      try {
        await withTimeout(
          client.connect(context.signal, CONNECT_TIMEOUT_MS),
          CONNECT_TIMEOUT_MS,
          "it did not start in time.",
        );
        const tools = await client.listTools(context.signal, LIST_TIMEOUT_MS);
        return { server, client, tools };
      } catch (error) {
        await client.close();
        if (context.signal.aborted) return null;
        const reason = error instanceof Error ? error.message : String(error);
        return { server, error: reason };
      }
    }),
  );

  const tools: ToolSet = {};
  const notices: string[] = [];
  for (const entry of connected) {
    if (!entry) continue;
    if ("error" in entry) {
      notices.push(`MCP server ${entry.server.name} is unavailable: ${entry.error}`);
      continue;
    }
    const { server, client } = entry;
    for (const info of entry.tools) {
      if (Object.keys(tools).length >= MAX_MCP_TOOLS) break;
      if (context.readOnly && !info.annotations?.readOnlyHint) continue;
      const name = toMcpToolName(server.name, info.name);
      if (tools[name]) continue;
      const summary = [info.title ?? info.annotations?.title, info.description]
        .filter(Boolean)
        .join(": ");
      tools[name] = tool({
        description: `Tool "${info.name}" from the ${server.name} MCP server. ${summary}`.trim(),
        inputSchema: jsonSchema<Record<string, unknown>>(info.inputSchema),
        execute: async (input, { toolCallId }) =>
          context.track(name, input, toolCallId, async () => {
            const approved = await context.authorize({
              serverId: server.id,
              serverName: server.name,
              tool: info.name,
              name,
              input,
            });
            if (!approved) return { executed: false, reason: "The user declined the tool call." };
            const output = await client.callTool(info.name, input, context.signal, CALL_TIMEOUT_MS);
            if (output.isError) throw new Error(output.content || "The MCP tool failed.");
            return output;
          }),
      });
    }
  }
  return { tools, notices, close };
}
